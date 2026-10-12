-- 0004: sheet ownership (BR-18). A sheet, its files and its counts are seen and changed only by the person who
-- uploaded it and by Admins. Written to be re-runnable: tests/sql/ownership.test.ts applies this body inside a
-- transaction that is rolled back, before the migration itself is applied.

-- ===== Rows =====
drop policy if exists sheets_read on public.spec_sheets;
drop policy if exists sheets_update on public.spec_sheets;
create policy sheets_read on public.spec_sheets for select to authenticated
  using ((select public.is_allowed_user()) and (created_by = (select auth.uid()) or (select public.is_admin())));
create policy sheets_update on public.spec_sheets for update to authenticated
  using ((select public.is_allowed_user()) and (created_by = (select auth.uid()) or (select public.is_admin())))
  with check ((select public.is_allowed_user()) and updated_by = (select auth.uid()));
-- sheets_insert is unchanged: it already requires created_by = auth.uid().

-- ===== Files =====
-- A file lives under "<sheet id>/". Whether a sheet exists is read past RLS (security definer), so a folder whose
-- sheet the caller cannot see still counts as taken.
create or replace function public.sheet_files_readable(p_folder text, p_object_owner text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if p_folder is null or p_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  select created_by into v_owner from spec_sheets where id = p_folder::uuid;
  if found then
    return v_owner = auth.uid() or is_admin();
  end if;
  -- no sheet yet: an upload in progress (createSheet lists the folder before it inserts the row), seen by its uploader only
  return p_object_owner is not null and p_object_owner = auth.uid()::text;
end $$;

create or replace function public.sheet_folder_free(p_folder text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_folder is null or p_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return not exists (select 1 from spec_sheets where id = p_folder::uuid);
end $$;

drop policy if exists spec_files_read on storage.objects;
drop policy if exists spec_files_add on storage.objects;
create policy spec_files_read on storage.objects for select to authenticated
  using (bucket_id = 'spec-sheets' and (select public.is_allowed_user())
         and public.sheet_files_readable((storage.foldername(name))[1], owner_id));
-- files are added only into a folder that has no sheet yet (a new upload); never updated or deleted (BR-03)
create policy spec_files_add on storage.objects for insert to authenticated
  with check (bucket_id = 'spec-sheets' and (select public.is_allowed_user())
              and public.sheet_folder_free((storage.foldername(name))[1]));

-- ===== The list =====
-- Columns are only appended, so code reading the old columns keeps working.
create or replace view public.sheet_list with (security_invoker = true) as
  select s.id, s.name, s.source_type, s.thumb_path, s.page_px_w, s.page_px_h,
         jsonb_array_length(s.edits) as edit_count, s.version,
         s.created_at, s.updated_at, coalesce(u.full_name, u.email) as updated_by_name,
         s.deleted_at, coalesce(d.full_name, d.email) as deleted_by_name,
         s.created_by, coalesce(c.full_name, c.email) as created_by_name
    from public.spec_sheets s
    join public.profiles u on u.id = s.updated_by
    left join public.profiles d on d.id = s.deleted_by
    join public.profiles c on c.id = s.created_by;

-- One function only, so PostgREST never sees two candidates; a call without arguments counts everything visible.
drop function if exists public.sheet_counts();
create or replace function public.sheet_counts(p_owner uuid default null) returns table (live bigint, trash bigint)
language sql stable security invoker set search_path = public as $$
  select count(*) filter (where deleted_at is null), count(*) filter (where deleted_at is not null)
    from spec_sheets
   where p_owner is null or created_by = p_owner
$$;

-- The people who own at least one visible sheet, live or in the Trash, for the Admin's Creator filter.
create or replace function public.sheet_owners() returns table (id uuid, name text, sheets bigint)
language sql stable security invoker set search_path = public as $$
  select p.id, coalesce(p.full_name, p.email), count(*)
    from spec_sheets s
    join profiles p on p.id = s.created_by
   group by p.id, p.full_name, p.email
   order by 2, 1
$$;

revoke all on function public.sheet_files_readable(text, text), public.sheet_folder_free(text),
                       public.sheet_counts(uuid), public.sheet_owners() from public, anon;
grant execute on function public.sheet_files_readable(text, text), public.sheet_folder_free(text),
                          public.sheet_counts(uuid), public.sheet_owners() to authenticated;
revoke all on public.sheet_list from anon, authenticated;
grant select on public.sheet_list to authenticated;
