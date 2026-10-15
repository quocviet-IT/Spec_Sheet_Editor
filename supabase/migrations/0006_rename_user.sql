-- 0006: an Admin renames a password account (Admin -> Users -> Rename).
-- A password account keeps the name its Admin entered (touch_profile, 0002); a Google account takes its name
-- from Google at every sign-in, so it is not renamed here.
-- Re-runnable: tests/sql/rename.test.ts applies this body inside a transaction that is rolled back.
-- Only a function is created; no table or policy lock is taken.
set local lock_timeout = '5s';

create or replace function public.rename_user(p_user uuid, p_full_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := btrim(coalesce(p_full_name, ''));
  v_old  profiles%rowtype;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if v_name = '' or length(v_name) > 120 then raise exception 'bad_name'; end if;
  select * into v_old from profiles where id = p_user for update;
  if not found then raise exception 'user_not_found'; end if;
  if not v_old.password_account then raise exception 'not_password_account'; end if;
  -- the same name again is no change: nothing is written or recorded
  if v_old.full_name is not distinct from v_name then return; end if;
  update profiles set full_name = v_name, updated_at = now() where id = p_user;
  perform _audit('user.rename', 'user', p_user::text,
                 jsonb_build_object('email', v_old.email, 'from', v_old.full_name, 'to', v_name));
end $$;

revoke all on function public.rename_user(uuid, text) from public, anon;
grant execute on function public.rename_user(uuid, text) to authenticated;
