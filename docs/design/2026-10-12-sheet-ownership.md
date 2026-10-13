# Sheet ownership: each sheet is seen by its creator and the Admins

Status: approved by the owner on 2026-10-12. This document describes the design; the implementation plan is
`docs/plans/2026-10-12-sheet-ownership.md`.

## Goal

Until now every person with access saw and could edit every sheet (BR-10: "Everyone can edit every sheet").
From now on:
- **Staff** see, open, edit, save, export, move to the Trash and restore **only the sheets they uploaded**.
- **Admins** see every sheet and may do everything with any sheet, exactly as with their own.

The owner's decisions (2026-10-12):
- Admins have full rights on other people's sheets, not view-only.
- A sheet belongs to the person who uploaded it. Existing sheets stay with their uploader, and there is no "assign to"
  action. A sheet an Admin uploads is therefore seen only by Admins.
- On the sheet list an Admin sees each sheet's creator and can filter by creator.
- The migration runs from the office network, where the SQL tests run first.

## New business rule

| Rule | Statement | Rationale |
| --- | --- | --- |
| BR-18 | A sheet, its original file and its thumbnail can be read and changed only by the person who uploaded it (`created_by`) and by Admins. This covers the list, the counts, the editor, saving, the Trash and restoring. Permanent deletion stays Admin-only (BR-16). | Requirement added on 12 October 2026: each person's sheets are their own work. |

BR-10 keeps its rule: the second save is told about the conflict. Its rationale becomes "the owner can have the
sheet open twice, and an Admin can edit a sheet while its owner does".

## Approach

The rule is enforced **in the database** (row-level security and storage policies), not only in the app. A page that
forgets to filter, a direct link to `/sheets/<id>`, or a guessed file path still reveals nothing. The other options
were rejected:
- Filtering only in the app: one missed query leaks a sheet.
- One storage folder per person: it would move every existing file, and gives no more protection than the policies.

## Database (migration 0004)

- **`spec_sheets`:**
  - The read policy changes from "any allowed user" to: allowed user **and** (`created_by = auth.uid()` or
    `is_admin()`).
  - The update policy gets the same `using` condition. Its `with check` keeps `updated_by = auth.uid()`.
  - The insert policy is unchanged; it already requires `created_by = auth.uid()`.
- **`save_sheet`:**
  - It runs as the caller, so the new policies apply to it without change.
  - Its conflict branch also reads through RLS, so a sheet the caller cannot see reports nothing about it.
- **Storage, bucket `spec-sheets`.** A file lives under `<sheet id>/`.
  - Read is allowed to an allowed user when **one** of these holds:
    - the folder's sheet exists and the caller may read it (creator or Admin);
    - no sheet exists for the folder yet and the caller uploaded the file (`owner_id = auth.uid()`).

    The second case is needed because `createSheet` lists the folder **before** it inserts the row (UC-03 step 6).
    Whether a sheet exists is checked by a `security definer` helper, so a row hidden by RLS still counts as
    existing.
  - Add is allowed only into a folder that has **no sheet yet**, so nobody can place a file in another person's
    sheet folder. Update and delete stay forbidden (BR-03).
- **`sheet_list` view:**
  - It gains `created_by` and `created_by_name` (`coalesce(full_name, email)` of the creator).
  - It stays `security_invoker`, so it inherits the new read rule.
  - The new columns are appended, so the running code keeps working before its own deploy.
- **`sheet_counts()`:**
  - It stays security invoker, so the tab counts follow the rule.
  - It is replaced by `sheet_counts(p_owner uuid default null)`, so an Admin's counts follow the creator filter.
  - The old function is dropped in the same migration, so PostgREST never sees two candidates. The running code's
    call without arguments keeps working through the default.
- **New `sheet_owners()`:**
  - Security invoker. It returns `(id, name, sheets)` for every person who owns at least one sheet, live or in the
    Trash, ordered by name.
  - It feeds the Admin's creator filter. Under RLS it returns only the caller for Staff, but Staff never see the
    filter.
  - The reserved test accounts appear only while an end-to-end run has sheets.
- No data migration: every row already has `created_by`.

## Screens

- **Staff:**
  - The sheet list looks as today and shows only their own sheets. The counts on the Sheets and Trash tabs count
    only theirs.
  - Opening another person's sheet by its link gives the editor's existing "sheet not found" page. The sheet's name
    is not revealed.
- **Admin, sheet list (`/sheets`):**
  - Each row shows "by <creator>" next to the existing metadata, on both tabs.
  - A **Creator** select sits beside the search box. Its options: All (the default), My sheets, then each person
    from `sheet_owners()` with their sheet count.
  - The choice is in the address as `owner` (`all` is the default and is left out; `me`, or a person's id), like
    `tab`, `q`, `page` and `size`. Changing it returns to page 1.
  - An unknown or malformed `owner` falls back to All, and so does an `owner` id that matches nobody who owns a sheet. For Staff the parameter is ignored.
  - The counts on the tabs follow the filter.
  - The Admin area's Trash page is unchanged, since it already lists every sheet in the Trash.
- **Admin, editor:** when an Admin opens a sheet someone else uploaded, a line under the title reads "Uploaded by
  <name>". Nothing else changes.
- **Guide:**
  - "Find sheets" says the list holds the sheets you uploaded, and that an Admin sees everyone's with a Creator
    filter.
  - "Save" no longer says a saved sheet is shared with everyone. It says that only you and the Admins see your
    sheets.
- Every new string goes in both dictionaries.

## Audit

No change. An Admin's save on someone else's sheet is already logged with the Admin as the actor.

## Testing

- **SQL** (`tests/sql/`, office network):
  - Staff A cannot select, update, save, trash or restore Staff B's sheet.
  - A cannot read B's files, and cannot add a file into B's sheet folder.
  - A can read their own files before the row exists, but not B's pending upload.
  - An Admin can do all of the above on B's sheet.
  - `sheet_counts()` and `sheet_owners()` return only what the caller may see.
  - `sheet_counts(p_owner)` filters for an Admin.
- **Unit:** parsing `owner` (`all`, `me`, a uuid, anything else), and the list URL builder keeping or resetting it.
- **End-to-end** (production, outside working hours):
  - e2e-staff-b does not see e2e-staff's sheet in the list, and gets "not found" on its direct link.
  - e2e-admin sees both sheets with their creators. The Creator filter narrows the list and the counts.
  - TC-38 (save conflict) becomes "the owner and an Admin edit the same sheet".
  - The guide capture keeps its own-rows guard.

## Rollout

1. Merge `feat/logo-and-sheet-paging` first; this work builds on the paged list.
2. On the office network, run the SQL tests against the database, then `npm run db:migrate` (0004).
   - The code running at that moment keeps working: the view only gains columns.
   - From that moment Staff see only their own sheets.
   - Tell the staff before this step.
3. Merge this branch; Vercel deploys it.
   - Never merge before step 2. The new code reads `created_by_name` and calls `sheet_owners()`, so the Sheets page
     shows its error message until 0004 is live. Nothing leaks in that state, but nobody can use the list.
4. Run the end-to-end specs outside working hours.

Also in 0004:
- `log_client_event`, the export log, accepts only a sheet the caller may read. Another person's sheet is "not
  found", like a missing one, so the log can neither be written against it nor used to probe whether it exists.
- Files left behind by a permanent deletion that failed halfway have no sheet any more. Like an upload in progress,
  they are readable by their uploader alone until the orphan clean-up removes them.

## Documents to update

- `docs/design/spec-sheet-editor-design.md`: BR-10's rationale, BR-18, F-03, UC-02 (the creator filter as an Admin
  extension), UC-08, the test-case table.
- `README.md`: one line on who sees which sheet.
