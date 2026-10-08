-- 0003: the sheet list (UC-02, UC-11). A security-invoker view, so RLS on spec_sheets and profiles
-- applies to the person asking, and a keyset-paged function: 50 rows per load, newest first, with a
-- partial, case-insensitive name search in which % and _ mean themselves.

create view public.sheet_list with (security_invoker = true) as
  select s.id, s.name, s.source_type, s.thumb_path, s.page_px_w, s.page_px_h,
         jsonb_array_length(s.edits) as edit_count, s.version,
         s.created_at, s.updated_at, coalesce(u.full_name, u.email) as updated_by_name,
         s.deleted_at, coalesce(d.full_name, d.email) as deleted_by_name
    from public.spec_sheets s
    join public.profiles u on u.id = s.updated_by
    left join public.profiles d on d.id = s.deleted_by;

-- Live sheets order by their last change, the Trash by deletion time; the id breaks ties so a page
-- boundary never repeats or skips a row. p_after_* is the last row of the previous page.
create function public.list_sheets(p_trash boolean, p_query text, p_after_time timestamptz, p_after_id uuid, p_limit int)
returns setof public.sheet_list
language sql stable security invoker set search_path = public as $$
  select l.*
    from sheet_list l
   where (l.deleted_at is not null) = coalesce(p_trash, false)
     and (coalesce(btrim(p_query), '') = ''
          or l.name ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     and (p_after_time is null
          or (case when p_trash then l.deleted_at else l.updated_at end, l.id) < (p_after_time, p_after_id))
   order by case when p_trash then l.deleted_at else l.updated_at end desc, l.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

create function public.sheet_counts() returns table (live bigint, trash bigint)
language sql stable security invoker set search_path = public as $$
  select count(*) filter (where deleted_at is null), count(*) filter (where deleted_at is not null)
    from spec_sheets
$$;

revoke all on public.sheet_list from anon, authenticated;
grant select on public.sheet_list to authenticated;
grant execute on function
  public.list_sheets(boolean, text, timestamptz, uuid, int),
  public.sheet_counts()
  to authenticated;
