-- 0005: feedback, a problem report or a suggestion filed from any page (docs/design/2026-10-13-feedback.md).
-- Re-runnable: tests/sql/feedback.test.ts applies this body inside a transaction that is rolled back.
-- Changing policies takes exclusive locks until the transaction ends; give up after 5 s instead of queueing readers.
set local lock_timeout = '5s';

-- ===== Reports =====
create table if not exists public.feedback_reports (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('broken', 'misread', 'suggestion')),
  impact          text not null check (impact in ('blocking', 'slows_work', 'minor')),
  description     text not null check (length(btrim(description)) >= 5 and length(description) <= 4000),
  page_url        text not null check (length(page_url) between 1 and 500),
  page_route      text not null check (length(page_route) between 1 and 200),
  page_label      text not null check (length(page_label) between 1 and 200),
  screenshot_path text,
  status          text not null default 'new' check (status in ('new', 'looking', 'fixed', 'declined')),
  triage_note     text check (triage_note is null or length(triage_note) <= 2000),
  reporter_id     uuid not null references public.profiles (id),
  created_at      timestamptz not null default now(),
  triaged_by      uuid references public.profiles (id),
  triaged_at      timestamptz,
  constraint feedback_declined_needs_a_reason
    check (status <> 'declined' or length(btrim(coalesce(triage_note, ''))) > 0)
);
create index if not exists feedback_reports_status   on public.feedback_reports (status, created_at desc);
create index if not exists feedback_reports_reporter on public.feedback_reports (reporter_id, created_at desc);
alter table public.feedback_reports enable row level security;

drop policy if exists feedback_file on public.feedback_reports;
create policy feedback_file on public.feedback_reports for insert to authenticated
  with check ((select public.is_allowed_user()) and reporter_id = (select auth.uid()) and status = 'new'
              and screenshot_path is null and triage_note is null and triaged_by is null and triaged_at is null);
drop policy if exists feedback_read on public.feedback_reports;
create policy feedback_read on public.feedback_reports for select to authenticated
  using ((select public.is_allowed_user()) and (reporter_id = (select auth.uid()) or (select public.is_admin())));
-- no update or delete policy: the status moves through set_feedback_status, the picture through attach_feedback_screenshot

revoke all on public.feedback_reports from anon, authenticated;
grant select, insert on public.feedback_reports to authenticated;

-- A filed report is evidence: only the triage columns change, and the picture is attached once.
create or replace function public.trg_feedback_evidence() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.kind <> old.kind or new.impact <> old.impact or new.description <> old.description
     or new.page_url <> old.page_url or new.page_route <> old.page_route or new.page_label <> old.page_label
     or new.reporter_id <> old.reporter_id or new.created_at <> old.created_at then
    raise exception 'feedback_is_evidence';
  end if;
  if new.screenshot_path is distinct from old.screenshot_path and old.screenshot_path is not null then
    raise exception 'screenshot_already_attached';
  end if;
  return new;
end $$;
drop trigger if exists feedback_evidence on public.feedback_reports;
create trigger feedback_evidence before update on public.feedback_reports
  for each row execute function public.trg_feedback_evidence();

-- The time a report was filed is the server's, not the client's.
create or replace function public.trg_feedback_stamp() returns trigger language plpgsql as $$
begin
  new.created_at := now();
  return new;
end $$;
drop trigger if exists feedback_stamp on public.feedback_reports;
create trigger feedback_stamp before insert on public.feedback_reports
  for each row execute function public.trg_feedback_stamp();

-- Filing is audited; _audit is closed to clients, so the trigger runs as its owner.
create or replace function public.trg_feedback_filed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform _audit('feedback.file', 'feedback', new.id::text, jsonb_build_object('kind', new.kind, 'impact', new.impact));
  return new;
end $$;
drop trigger if exists feedback_filed on public.feedback_reports;
create trigger feedback_filed after insert on public.feedback_reports
  for each row execute function public.trg_feedback_filed();

-- ===== Triage =====
-- security definer bypasses RLS, so the Admin check is made here. A null note keeps the old one; an empty note clears it.
create or replace function public.set_feedback_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before text;
  v_old_note text;
  v_note text;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_status is null or p_status not in ('new', 'looking', 'fixed', 'declined') then raise exception 'invalid_status'; end if;
  if p_note is not null and length(p_note) > 2000 then raise exception 'note_too_long'; end if;
  select status, triage_note into v_before, v_old_note from feedback_reports where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  v_note := case when p_note is null then v_old_note else nullif(btrim(p_note), '') end;
  if p_status = 'declined' and v_note is null then raise exception 'decline_needs_reason'; end if;
  -- nothing changes: no new triage time (it would tell the reporter something moved) and no audit entry
  if p_status = v_before and v_note is not distinct from v_old_note then return; end if;
  update feedback_reports
     set status = p_status, triage_note = v_note, triaged_by = auth.uid(), triaged_at = now()
   where id = p_id;
  perform _audit('feedback.status', 'feedback', p_id::text,
                 jsonb_build_object('from', v_before, 'to', p_status, 'note_changed', v_note is distinct from v_old_note));
end $$;

-- ===== The picture =====
create or replace function public.feedback_screenshot_path_valid(p_name text) returns boolean language sql immutable as $$
  select coalesce(p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$', false)
$$;

-- A picture goes only into the caller's own report folder, before one is attached, and only one file per folder.
create or replace function public.feedback_screenshot_may_add(p_name text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_folder text;
begin
  if not feedback_screenshot_path_valid(p_name) then return false; end if;
  v_folder := split_part(p_name, '/', 1);
  return exists (select 1 from feedback_reports where id = v_folder::uuid and reporter_id = auth.uid() and screenshot_path is null)
     and not exists (select 1 from storage.objects where bucket_id = 'feedback-screenshots' and name like v_folder || '/%');
end $$;

create or replace function public.feedback_screenshot_readable(p_name text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not feedback_screenshot_path_valid(p_name) then return false; end if;
  return is_admin() or exists (select 1 from feedback_reports where id = split_part(p_name, '/', 1)::uuid and reporter_id = auth.uid());
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-screenshots', 'feedback-screenshots', false, 5242880, array['image/png'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists feedback_shot_add on storage.objects;
create policy feedback_shot_add on storage.objects for insert to authenticated
  with check (bucket_id = 'feedback-screenshots' and (select public.is_allowed_user()) and public.feedback_screenshot_may_add(name));
drop policy if exists feedback_shot_read on storage.objects;
create policy feedback_shot_read on storage.objects for select to authenticated
  using (bucket_id = 'feedback-screenshots' and (select public.is_allowed_user()) and public.feedback_screenshot_readable(name));
-- never updated or deleted by a client

-- Links the uploaded picture to the report. The report has no update policy, so this narrow definer does it.
create or replace function public.attach_feedback_screenshot(p_report_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reporter uuid;
  v_existing text;
begin
  if not is_allowed_user() then raise exception 'forbidden'; end if;
  select reporter_id, screenshot_path into v_reporter, v_existing from feedback_reports where id = p_report_id for update;
  if not found or v_reporter is distinct from auth.uid() then raise exception 'not_found'; end if;
  if v_existing is not null then raise exception 'screenshot_already_attached'; end if;
  if not feedback_screenshot_path_valid(p_path) or split_part(p_path, '/', 1) <> p_report_id::text then
    raise exception 'invalid_path';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'feedback-screenshots' and name = p_path) then
    raise exception 'file_missing';
  end if;
  update feedback_reports set screenshot_path = p_path where id = p_report_id;
end $$;

-- ===== Counts and the unread signal =====
create or replace function public.feedback_counts() returns table (status text, n bigint)
language sql stable security invoker set search_path = public as $$
  select status, count(*) from feedback_reports group by status
$$;

create table if not exists public.feedback_seen (
  user_id uuid primary key references public.profiles (id),
  seen_at timestamptz not null default now()
);
alter table public.feedback_seen enable row level security;
drop policy if exists feedback_seen_own on public.feedback_seen;
create policy feedback_seen_own on public.feedback_seen for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.feedback_seen from anon, authenticated;
grant select, insert, update on public.feedback_seen to authenticated;

create or replace function public.feedback_seen_at() returns timestamptz
language sql stable security invoker set search_path = public as $$
  select coalesce((select seen_at from feedback_seen where user_id = auth.uid()), '-infinity'::timestamptz)
$$;

-- An Admin: reports still New. Staff: their own reports moved since they last opened the Feedback page.
create or replace function public.feedback_unseen() returns int
language sql stable security invoker set search_path = public as $$
  select case
    when (select is_admin()) then (select count(*) from feedback_reports where status = 'new')
    else (select count(*) from feedback_reports r
           where r.reporter_id = auth.uid() and r.triaged_at is not null and r.triaged_at > feedback_seen_at())
  end::int
$$;

create or replace function public.mark_feedback_seen() returns timestamptz
language plpgsql security invoker set search_path = public as $$
declare
  v_at timestamptz := clock_timestamp(); -- the moment of the visit, not the start of the transaction
begin
  if auth.uid() is null or not is_allowed_user() then raise exception 'forbidden'; end if;
  insert into feedback_seen (user_id, seen_at) values (auth.uid(), v_at)
  on conflict (user_id) do update set seen_at = excluded.seen_at;
  return v_at;
end $$;

-- ===== Privileges =====
revoke all on function
  public.set_feedback_status(uuid, text, text), public.attach_feedback_screenshot(uuid, text),
  public.feedback_screenshot_path_valid(text), public.feedback_screenshot_may_add(text), public.feedback_screenshot_readable(text),
  public.feedback_counts(), public.feedback_seen_at(), public.feedback_unseen(), public.mark_feedback_seen(),
  public.trg_feedback_evidence(), public.trg_feedback_stamp(), public.trg_feedback_filed()
  from public, anon;
grant execute on function
  public.set_feedback_status(uuid, text, text), public.attach_feedback_screenshot(uuid, text),
  public.feedback_screenshot_path_valid(text), public.feedback_screenshot_may_add(text), public.feedback_screenshot_readable(text),
  public.feedback_counts(), public.feedback_seen_at(), public.feedback_unseen(), public.mark_feedback_seen()
  to authenticated;
