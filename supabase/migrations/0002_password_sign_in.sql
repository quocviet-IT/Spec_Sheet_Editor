-- 0002: password sign-in for accounts an Admin creates in the app; Google sign-in stays for later.
-- Decisions (2026-10-08): the sign-in name is the person's email; an Admin creates the account and
-- hands over a one-time password; the person must set their own password before anything else;
-- Google and password sign-in will run side by side once Google is switched on.

-- ===== Profiles: how the account signs in =====
alter table public.profiles
  add column password_account     boolean not null default false,
  add column must_change_password boolean not null default false;

-- The password hash the database last saw for each password account, and who set that password (an
-- Admin issuing a one-time password, or the person). A new password means a new hash, which is how
-- the database tells a real change from a call that changed nothing.
-- No policies and no client grants: only the functions below read or write it.
create table public.password_snapshots (
  user_id  uuid primary key references public.profiles (id) on delete cascade,
  hash     text not null,
  set_by   uuid references public.profiles (id),
  taken_at timestamptz not null default now()
);
alter table public.password_snapshots enable row level security;
revoke all on public.password_snapshots from anon, authenticated;

-- A password account keeps the name its Admin entered: the JWT's user_metadata is editable by the
-- person and may be empty. Otherwise identical to 0001.
create or replace function public.touch_profile() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_allowed_user() then raise exception 'forbidden'; end if;
  insert into profiles (id, email, full_name, avatar_url, last_seen_at)
  values (auth.uid(), lower(auth.jwt() ->> 'email'),
          auth.jwt() -> 'user_metadata' ->> 'full_name',
          auth.jwt() -> 'user_metadata' ->> 'avatar_url', now())
  on conflict (id) do update
     set email        = excluded.email,
         -- a password account keeps the name its Admin entered; never replace a name with nothing
         full_name    = case when profiles.password_account then profiles.full_name
                             else coalesce(excluded.full_name, profiles.full_name) end,
         avatar_url   = coalesce(excluded.avatar_url, profiles.avatar_url),
         last_seen_at = now(),
         updated_at   = now();
  perform _audit('auth.login', 'user', auth.uid()::text, '{}');
end $$;

-- ===== Access checks (BR-08), revised =====
-- Google: the address is proven by Google; the permitted-domain and permitted-email lists decide.
-- Password: only an account an Admin created (password_account) may enter. A self-made email account,
-- should sign-ups ever be switched on, has no such profile and is refused. An account an Admin created
-- may enter whichever way it signs in: a Google identity linked to the same email later is the same
-- person (owner decision: side by side).
-- Either way the account must not be suspended or still be on a one-time password.
create or replace function public.is_allowed_user() returns boolean
language sql stable security definer set search_path = public as $$
  with me as (
    select lower(coalesce(auth.jwt() ->> 'email', '')) as email,
           coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') as provider
  )
  select not exists (select 1 from profiles p
                      where p.id = auth.uid() and (p.status = 'suspended' or p.must_change_password))
     and (
       (me.provider = 'google'
        and me.email ~ '^[^@\s]+@[^@\s]+$'
        and (exists (select 1 from allowed_domains d where d.domain = split_part(me.email, '@', 2))
             or exists (select 1 from allowed_emails e where e.email = me.email)))
       or exists (select 1 from profiles p where p.id = auth.uid() and p.password_account)
     )
  from me
$$;

create or replace function public.my_access_status() returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'signed_out'
    when exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'suspended') then 'suspended'
    when exists (select 1 from profiles p where p.id = auth.uid() and p.must_change_password) then 'must_change_password'
    when not public.is_allowed_user() then 'not_permitted'
    else 'ok'
  end
$$;

-- ===== Password accounts =====
-- The app first creates the sign-in account with the secret key (auth.admin.createUser), then calls
-- this in the Admin's own session, so the audit row names the Admin.
create function public.admin_register_password_account(p_user uuid, p_full_name text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user auth.users%rowtype;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_role is null or p_role not in ('user', 'admin') then raise exception 'bad_role'; end if;
  if coalesce(btrim(p_full_name), '') = '' or length(btrim(p_full_name)) > 120 then raise exception 'bad_name'; end if;
  select * into v_user from auth.users where id = p_user;
  if not found then raise exception 'user_not_found'; end if;
  if coalesce(v_user.raw_app_meta_data ->> 'provider', '') <> 'email'
     or coalesce(v_user.encrypted_password, '') = '' then
    raise exception 'not_password_account';
  end if;
  -- only an account the app has just created; never adopt an older sign-up
  if v_user.created_at is null or v_user.created_at < now() - interval '10 minutes' then
    raise exception 'stale_account';
  end if;
  if exists (select 1 from profiles where id = p_user) then raise exception 'already_registered'; end if;
  insert into profiles (id, email, full_name, role, password_account, must_change_password)
  values (p_user, lower(v_user.email), btrim(p_full_name), p_role, true, true);
  insert into password_snapshots (user_id, hash, set_by)
  values (p_user, v_user.encrypted_password, auth.uid());
  perform _audit('user.create', 'user', p_user::text,
                 jsonb_build_object('email', lower(v_user.email), 'role', p_role, 'sign_in', 'password'));
end $$;

-- The app first sets the new one-time password with the secret key (auth.admin.updateUserById), then
-- calls this in the Admin's own session.
create function public.admin_mark_password_reset(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_hash  text;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'self_reset'; end if;
  select p.email into v_email from profiles p where p.id = p_user and p.password_account;
  if not found then raise exception 'not_password_account'; end if;
  select encrypted_password into v_hash from auth.users where id = p_user;
  update profiles set must_change_password = true, updated_at = now() where id = p_user;
  insert into password_snapshots (user_id, hash, set_by)
  values (p_user, v_hash, auth.uid())
  on conflict (user_id) do update
     set hash = excluded.hash, set_by = excluded.set_by, taken_at = now();
  -- Whoever holds a session for this account must sign in again with the new one-time password.
  delete from auth.sessions where user_id = p_user;
  perform _audit('user.password_reset', 'user', p_user::text, jsonb_build_object('email', v_email));
end $$;

-- The person calls this after setting a new password (auth.updateUser), forced or voluntary. It is
-- recorded only if the password really changed, which the database sees as a different hash; a
-- one-time password is replaced the same way.
create function public.finish_password_change() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_hash    text;
  v_last    text;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found or not v_profile.password_account then raise exception 'not_password_account'; end if;
  if v_profile.status = 'suspended' then raise exception 'forbidden'; end if;
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  select hash into v_last from password_snapshots where user_id = auth.uid();
  if v_hash is not distinct from v_last then raise exception 'password_unchanged'; end if;
  insert into password_snapshots (user_id, hash, set_by) values (auth.uid(), v_hash, auth.uid())
  on conflict (user_id) do update set hash = excluded.hash, set_by = excluded.set_by, taken_at = now();
  if v_profile.must_change_password then
    update profiles set must_change_password = false, updated_at = now() where id = auth.uid();
  end if;
  perform _audit('user.password_changed', 'user', auth.uid()::text,
                 jsonb_build_object('replaced_one_time_password', v_profile.must_change_password));
end $$;

grant execute on function
  public.admin_register_password_account(uuid, text, text),
  public.admin_mark_password_reset(uuid),
  public.finish_password_change()
  to authenticated;

-- First Admin: `npm run admin:create -- <email> "<Full name>"` (README, Setup). Later accounts are
-- created in the app: Admin → Users.
