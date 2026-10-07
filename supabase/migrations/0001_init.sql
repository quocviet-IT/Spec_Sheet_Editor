-- 0001_init: Spec Sheet Editor schema (design v1.2, Appendix A, plus my_access_status and the bucket).

-- ===== Tables =====
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  full_name    text,
  avatar_url   text,
  role         text not null default 'user'   check (role in ('user', 'admin')),
  status       text not null default 'active' check (status in ('active', 'suspended')),
  suspended_at timestamptz,
  suspended_by uuid references public.profiles (id),
  last_seen_at timestamptz,
  updated_at   timestamptz not null default now()
);

create table public.allowed_domains (
  domain     text primary key check (domain = lower(domain) and domain !~ '\s' and domain like '%.%'),
  note       text,
  created_at timestamptz not null default now()
);
create table public.allowed_emails (
  email      text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  note       text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
insert into public.allowed_domains (domain, note) values ('ctyhp.vn', 'default');

create table public.app_settings (
  key        text primary key
             check (key in ('max_file_mb', 'lowres_warn_px', 'aspect_tolerance_pct', 'signed_url_ttl_min')),
  value      numeric not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('max_file_mb', 20), ('lowres_warn_px', 2000), ('aspect_tolerance_pct', 2), ('signed_url_ttl_min', 10);

create table public.spec_sheets (
  id          uuid primary key,
  name        text not null check (length(btrim(name)) between 1 and 200),
  source_type text not null check (source_type in ('pdf', 'png', 'jpg')),
  source_path text not null,
  thumb_path  text not null,
  page_px_w   int  not null check (page_px_w > 0),
  page_px_h   int  not null check (page_px_h > 0),
  detections  jsonb not null default '[]' check (jsonb_typeof(detections) = 'array'),
  edits       jsonb not null default '[]' check (jsonb_typeof(edits) = 'array'),
  version     int  not null default 1,
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_by  uuid not null references public.profiles (id),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id),
  -- BR-03: a row can only point at its own files, so purging one sheet can never delete another's
  constraint spec_sheets_own_files check (
    source_path = id::text || '/source.' || source_type and thumb_path = id::text || '/thumb.jpg')
);
create index spec_sheets_live  on public.spec_sheets (updated_at desc) where deleted_at is null;
create index spec_sheets_trash on public.spec_sheets (deleted_at desc) where deleted_at is not null;

create table public.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid references public.profiles (id),  -- accounts are suspended, never deleted (BR-13)
  actor_email text,
  action      text not null,
  target_type text,
  target_id   text,
  detail      jsonb not null default '{}'
);
create index audit_log_time   on public.audit_log (occurred_at desc);
create index audit_log_actor  on public.audit_log (actor_id, occurred_at desc);
create index audit_log_target on public.audit_log (target_type, target_id);

-- ===== Access checks (BR-08) =====
-- Google sign-in only: an email/password or anonymous session on a permitted domain is refused even
-- if those providers are switched on by mistake (the email claim alone is not proof of the address).
create function public.is_allowed_user() returns boolean
language sql stable security definer set search_path = public as $$
  with me as (
    select lower(coalesce(auth.jwt() ->> 'email', '')) as email,
           coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') as provider
  )
  select me.provider = 'google'
     and me.email ~ '^[^@\s]+@[^@\s]+$'
     and (exists (select 1 from allowed_domains d where d.domain = split_part(me.email, '@', 2))
          or exists (select 1 from allowed_emails e where e.email = me.email))
     and not exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'suspended')
  from me
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_allowed_user()
     and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.status = 'active')
$$;

-- Lets the app tell "suspended" from "not permitted" without reading tables RLS hides from those users.
create function public.my_access_status() returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'signed_out'
    when exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'suspended') then 'suspended'
    when not public.is_allowed_user() then 'not_permitted'
    else 'ok'
  end
$$;

-- ===== Audit log (BR-15) =====
create function public._audit(p_action text, p_target_type text, p_target_id text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, actor_email, action, target_type, target_id, detail)
  values (auth.uid(), auth.jwt() ->> 'email', p_action, p_target_type, p_target_id, coalesce(p_detail, '{}'))
$$;
revoke execute on function public._audit(text, text, text, jsonb) from public, anon, authenticated;

create function public.trg_audit_append_only() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_no_update   before update or delete on public.audit_log
  for each statement execute function public.trg_audit_append_only();
create trigger audit_no_truncate before truncate on public.audit_log
  for each statement execute function public.trg_audit_append_only();

create function public.log_client_event(p_action text, p_target_id uuid, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_allowed_user() then raise exception 'forbidden'; end if;
  if p_action not in ('sheet.export_png', 'sheet.export_pdf') then raise exception 'action_not_allowed'; end if;
  -- the audit log can never be pruned, so a client may not grow it with large or dangling rows
  if pg_column_size(coalesce(p_detail, '{}'::jsonb)) > 2048 then raise exception 'detail_too_large'; end if;
  if not exists (select 1 from spec_sheets where id = p_target_id) then raise exception 'sheet_not_found'; end if;
  perform _audit(p_action, 'sheet', p_target_id::text, p_detail);
end $$;

-- ===== Profiles =====
create function public.touch_profile() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_allowed_user() then raise exception 'forbidden'; end if;
  insert into profiles (id, email, full_name, avatar_url, last_seen_at)
  values (auth.uid(), lower(auth.jwt() ->> 'email'),
          auth.jwt() -> 'user_metadata' ->> 'full_name',
          auth.jwt() -> 'user_metadata' ->> 'avatar_url', now())
  on conflict (id) do update
     set email = excluded.email, full_name = excluded.full_name,
         avatar_url = excluded.avatar_url, last_seen_at = now(), updated_at = now();
  perform _audit('auth.login', 'user', auth.uid()::text, '{}');
end $$;

create function public.trg_profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- two Admins cannot demote each other at once; ordinary sign-ins (touch_profile) do not queue here
  if new.role is distinct from old.role or new.status is distinct from old.status then
    perform pg_advisory_xact_lock(hashtext('admin_guard'));
  end if;
  if old.role = 'admin' and old.status = 'active'
     and (new.role <> 'admin' or new.status <> 'active')
     and not exists (select 1 from profiles p
                      where p.id <> old.id and p.role = 'admin' and p.status = 'active') then
    raise exception 'last_admin' using hint = 'At least one active admin must remain.';
  end if;
  if new.role is distinct from old.role then
    perform _audit('user.role_change', 'user', new.id::text,
                   jsonb_build_object('email', new.email, 'from', old.role, 'to', new.role));
  end if;
  if new.status is distinct from old.status then
    perform _audit(case when new.status = 'suspended' then 'user.suspend' else 'user.unsuspend' end,
                   'user', new.id::text, jsonb_build_object('email', new.email));
  end if;
  return new;
end $$;
create trigger profile_guard before update on public.profiles
  for each row execute function public.trg_profile_guard();

create function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  update profiles set role = p_role, updated_at = now() where id = p_user;
  if not found then raise exception 'user_not_found'; end if;
end $$;

create function public.set_user_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() and p_status = 'suspended' then raise exception 'self_suspend'; end if;
  update profiles
     set status       = p_status,
         suspended_at = case when p_status = 'suspended' then now() end,
         suspended_by = case when p_status = 'suspended' then auth.uid() end,
         updated_at   = now()
   where id = p_user;
  if not found then raise exception 'user_not_found'; end if;
end $$;

-- ===== Access (BR-17) and settings =====
create function public.add_allowed(p_kind text, p_value text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := lower(btrim(p_value));
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_kind not in ('domain', 'email') then raise exception 'invalid_kind'; end if;
  if p_kind = 'domain' then insert into allowed_domains (domain, note) values (v, p_note);
  else insert into allowed_emails (email, note, created_by) values (v, p_note, auth.uid()); end if;
  perform _audit('access.add', p_kind, v, jsonb_build_object('note', p_note));
end $$;

create function public.remove_allowed(p_kind text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := lower(btrim(p_value));
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_kind not in ('domain', 'email') then raise exception 'invalid_kind'; end if;
  if p_kind = 'domain' then delete from allowed_domains where domain = v;
  else delete from allowed_emails where email = v; end if;
  if not is_allowed_user() then raise exception 'self_lockout'; end if;   -- rolls back the whole call
  perform _audit('access.remove', p_kind, v, '{}');
end $$;

create function public.set_setting(p_key text, p_value numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_old numeric;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if not ((p_key = 'max_file_mb'          and p_value between 1 and 50)
       or (p_key = 'lowres_warn_px'       and p_value between 800 and 5000)
       or (p_key = 'aspect_tolerance_pct' and p_value between 0.5 and 5)
       or (p_key = 'signed_url_ttl_min'   and p_value between 1 and 60)) then
    raise exception 'out_of_range';
  end if;
  select value into v_old from app_settings where key = p_key for update;
  update app_settings set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
  perform _audit('settings.update', 'setting', p_key, jsonb_build_object('from', v_old, 'to', p_value));
end $$;

-- ===== Sheets =====
-- BR-10/BR-15: a direct UPDATE may only move a sheet to or from the Trash. Content changes go through
-- save_sheet, which raises the version by exactly one (and so is audited). Who trashed a sheet, and
-- when, is recorded here rather than taken from the client.
create function public.trg_sheet_guard() returns trigger language plpgsql as $$
declare
  v_content boolean := new.name is distinct from old.name or new.detections <> old.detections
                       or new.edits <> old.edits or new.version <> old.version;
begin
  if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at
     or new.source_path <> old.source_path or new.thumb_path <> old.thumb_path
     or new.source_type <> old.source_type
     or new.page_px_w <> old.page_px_w or new.page_px_h <> old.page_px_h then
    raise exception 'immutable_column';
  end if;

  if (old.deleted_at is null) <> (new.deleted_at is null) then
    if v_content then raise exception 'trash_with_changes'; end if;
    if new.deleted_at is not null then
      new.deleted_at := now();
      new.deleted_by := auth.uid();
    else
      new.deleted_by := null;
    end if;
  else
    new.deleted_at := old.deleted_at;
    new.deleted_by := old.deleted_by;
    if v_content then
      if old.deleted_at is not null then raise exception 'sheet_in_trash'; end if;
      if new.version <> old.version + 1 then raise exception 'version_must_increment'; end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;
create trigger sheet_guard before update on public.spec_sheets
  for each row execute function public.trg_sheet_guard();

create function public.trg_sheet_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform _audit('sheet.upload', 'sheet', new.id::text, jsonb_build_object('name', new.name, 'type', new.source_type));
  elsif tg_op = 'DELETE' then
    perform _audit('sheet.purge', 'sheet', old.id::text, jsonb_build_object(
      'name', old.name, 'source_path', old.source_path, 'created_by', old.created_by, 'deleted_by', old.deleted_by));
  elsif old.deleted_at is null and new.deleted_at is not null then
    perform _audit('sheet.trash', 'sheet', new.id::text, jsonb_build_object('name', new.name));
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform _audit('sheet.restore', 'sheet', new.id::text, jsonb_build_object('name', new.name));
  elsif new.version <> old.version then
    perform _audit(case when new.edits = old.edits and new.name = old.name then 'sheet.detect' else 'sheet.save' end,
                   'sheet', new.id::text, jsonb_build_object(
                     'version', new.version, 'edits', jsonb_array_length(new.edits),
                     'renamed', new.name is distinct from old.name));
  end if;
  return coalesce(new, old);
end $$;
create trigger sheet_audit after insert or update or delete on public.spec_sheets
  for each row execute function public.trg_sheet_audit();

-- BR-10: version check and save in one statement; runs as the caller, so RLS still applies
create function public.save_sheet(p_id uuid, p_version int, p_name text, p_detections jsonb, p_edits jsonb)
returns table (saved boolean, new_version int, is_deleted boolean, by_name text, saved_at timestamptz)
language plpgsql security invoker set search_path = public as $$
begin
  return query
    with u as (
      update spec_sheets s
         set name       = coalesce(p_name, s.name),
             detections = coalesce(p_detections, s.detections),
             edits      = coalesce(p_edits, s.edits),
             version    = s.version + 1,
             updated_by = auth.uid(),
             updated_at = now()
       where s.id = p_id and s.version = p_version and s.deleted_at is null
      returning s.version, s.updated_at
    )
    select true, u.version, false, null::text, u.updated_at from u;
  if not found then
    return query
      select false, s.version, s.deleted_at is not null, p.full_name, s.updated_at
        from spec_sheets s left join profiles p on p.id = s.updated_by
       where s.id = p_id;
  end if;
end $$;

create function public.purge_sheet(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  delete from spec_sheets where id = p_id and deleted_at is not null;   -- the trigger logs sheet.purge
  if not found then raise exception 'not_in_trash'; end if;
end $$;

create function public.log_maintenance(p_folders int, p_bytes bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  perform _audit('maintenance.orphan_cleanup', 'storage', 'spec-sheets',
                 jsonb_build_object('folders', p_folders, 'bytes', p_bytes));
end $$;

-- ===== RLS =====
alter table public.profiles        enable row level security;
alter table public.allowed_domains enable row level security;
alter table public.allowed_emails  enable row level security;
alter table public.app_settings    enable row level security;
alter table public.spec_sheets     enable row level security;
alter table public.audit_log       enable row level security;

create policy profiles_read on public.profiles        for select to authenticated using ((select public.is_allowed_user()));
create policy domains_read  on public.allowed_domains for select to authenticated using ((select public.is_admin()));
create policy emails_read   on public.allowed_emails  for select to authenticated using ((select public.is_admin()));
create policy settings_read on public.app_settings    for select to authenticated using ((select public.is_allowed_user()));
create policy audit_read    on public.audit_log       for select to authenticated using ((select public.is_admin()));
-- profiles, allowed_*, app_settings, audit_log: no write policies; changed only through the functions above

create policy sheets_read   on public.spec_sheets for select to authenticated using ((select public.is_allowed_user()));
create policy sheets_insert on public.spec_sheets for insert to authenticated
  with check ((select public.is_allowed_user()) and created_by = auth.uid() and updated_by = auth.uid()
              and version = 1 and deleted_at is null and deleted_by is null);
create policy sheets_update on public.spec_sheets for update to authenticated
  using ((select public.is_allowed_user()))
  with check ((select public.is_allowed_user()) and updated_by = auth.uid());
-- no delete policy: permanent deletion only through purge_sheet()

-- ===== Privileges =====
-- RLS limits which rows; grants limit what a role may attempt at all. Stated here instead of relying
-- on Supabase's default privileges, which give anon and authenticated everything (TRUNCATE included,
-- which RLS does not cover) and EXECUTE on every function. service_role keeps its defaults.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant select on public.profiles, public.allowed_domains, public.allowed_emails,
                public.app_settings, public.audit_log, public.spec_sheets to authenticated;
grant insert, update on public.spec_sheets to authenticated;

grant execute on function
  public.is_allowed_user(), public.is_admin(), public.my_access_status(), public.touch_profile(),
  public.log_client_event(text, uuid, jsonb),
  public.set_user_role(uuid, text), public.set_user_status(uuid, text),
  public.add_allowed(text, text, text), public.remove_allowed(text, text), public.set_setting(text, numeric),
  public.save_sheet(uuid, int, text, jsonb, jsonb), public.purge_sheet(uuid), public.log_maintenance(int, bigint)
  to authenticated;

-- ===== Storage =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spec-sheets', 'spec-sheets', false, 52428800, array['application/pdf', 'image/png', 'image/jpeg']);

-- bucket spec-sheets only; read and add, never update or delete (BR-03)
create policy spec_files_read on storage.objects for select to authenticated
  using (bucket_id = 'spec-sheets' and (select public.is_allowed_user()));
create policy spec_files_add  on storage.objects for insert to authenticated
  with check (bucket_id = 'spec-sheets' and (select public.is_allowed_user())
              and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- First Admin: run once, after that person's first sign-in
--   update public.profiles set role = 'admin' where email = '<admin-email>';
