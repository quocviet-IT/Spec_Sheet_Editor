# Spec Sheet Editor — Build Roadmap

> This file is the map, not a task list. Each milestone gets its own
> step-by-step plan in this folder (`2026-10-07-m1-foundation.md` is the first). Write the next
> milestone's plan only when the previous milestone's exit criteria pass — later plans depend on
> what earlier milestones learn (above all the browser OCR numbers from M2).

**Goal:** Build Spec Sheet Editor as a new, standalone web app, as specified in
[`docs/design/spec-sheet-editor-design.md`](../design/spec-sheet-editor-design.md) (design v1.2).

**Architecture:** Next.js 16 on Vercel (`sin1`) with Supabase (Postgres + RLS, Storage, Google
Auth) in Singapore. All image work — PDF rendering, OCR, masking, drawing, export — runs in the
browser; the server handles sign-in, data and two service-role admin jobs. Permissions are
enforced in three layers (UI, server, database).

**Tech stack:** Next.js 16.3, React 19.2, TypeScript 5, Tailwind CSS 4, Zod 4, @supabase/ssr 0.12,
@supabase/supabase-js 2, postgres.js 3 (scripts/tests only), pdfjs-dist, onnxruntime-web,
PaddleOCR PP-OCRv4 small (ONNX), pdf-lib, Vitest 4, Playwright 1.6x, pixelmatch.

## Global constraints (every milestone)

- Repository: `https://github.com/quocviet-IT/Spec_Sheet_Editor` — **public**. Never commit real
  sheets, SO/MO numbers or keys. `samples/` and `.env*.local` are git-ignored; stage files one by
  one and grep the diff for `SO2`, `MO2`, `sb_secret_`, `service_role` before every push.
- Push only to the `quocviet-IT` account.
- File names, commit messages and documents are in English. The only Vietnamese text in the repository is interface copy: the dictionary `src/messages/vi.ts` and the language's own name ("Tiếng Việt") on the VI/EN switch.
- Interface is **bilingual Vietnamese / English** with a VI/EN switch; default `vi`. Every
  user-facing string lives in `src/messages/vi.ts` + `src/messages/en.ts`; a missing key must
  fail the build. Exported sheets keep the original English wording.
- Code, identifiers and comments in English.
- Supabase and Vercel functions in Singapore (`ap-southeast-1` / `sin1`).
- Permitted domain by default: `ctyhp.vn`. First Admin is set with one SQL statement after their
  first sign-in.
- Nothing exported (PNG/PDF) is stored on the server.
- Every list read pages with `range()` (PostgREST silently caps at 1,000 rows).
- Every `storage.objects` policy includes `bucket_id = 'spec-sheets'`.
- Playwright runs always carry a hard timeout.
- Before calling a UI task done, take a screenshot and look at it in both languages and both themes.

## Prerequisites (owner: project owner, before M1 Task 6)

These touch accounts and billing, so only the project owner does them.

1. **Supabase:** create a new project in region **Southeast Asia (Singapore)**. Then:
   - *Authentication → Sign In / Providers:* keep **Email** enabled and turn **off** "Allow new users to
     sign up": accounts are created only by an Admin (the admin API ignores this switch). Turn off
     Phone and Anonymous sign-ins.
   - *Authentication → URL configuration:* list only exact callback URLs
     (`http://localhost:3000/auth/callback`, later the production one) — needed once Google is
     switched on (Google sign-in is optional and off by default, `GOOGLE_SIGN_IN=off`).
   - *Project Settings → API Keys:* copy the **publishable** key and a **secret** key.
   - *Connect → Session pooler:* copy the connection string (port 5432) with the DB password.
2. **Google Cloud Console:** OAuth client (Web application) with authorised redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`. OAuth consent screen: Internal (Workspace)
   if available.
3. **Local env:** create `.env.local` in the repo root from `.env.example` and fill:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
   `DATABASE_URL` (session pooler).
4. **Vercel (before M7, optional earlier):** import the GitHub repo, framework Next.js, set the same
   four variables, Function Region `sin1`.

## Milestones

| # | Milestone | Delivers | Exit criteria (design test cases) | Depends on |
|---|---|---|---|---|
| M1 | Foundation | Next.js app, design tokens, bilingual shell, migration `0001_init.sql` (all tables, functions, triggers, RLS, bucket), migration runner, SQL test harness, Google sign-in, access guard, sign-out, CI | Unit tests green; `next build` green; SQL tests TC-03, 04, 05, 49, 50, 56, 57, 59, 61, 65, 69, 70, 71, 73 green against the dev project; manual sign-in with the first Admin's one-time password, forced password change, a second account created in Admin → Users, and a wrong password refused | Prerequisites 1–3 for the SQL tests and sign-in check |
| M2 | Browser OCR | `lib/ocr`: PP-OCRv4 small on onnxruntime-web in a Web Worker (pre/post-processing ported from RapidOCR: DB box decoding, CTC decoding), scan of the drawing area at 0° and 90° CW, read-on-click; `/dev/ocr-bench` page that scores the 11-value sample | TC-20 ≥ 9/11 located in ≤ 60 s and TC-24 ≤ 5 s **in Chrome on an office PC**; decision recorded: keep v4 small or switch to v6 small | M1 (app shell only); can start in parallel with M1 Tasks 4–7 |
| M3 | Sheets pipeline | `lib/form` (ratio, editable zone, trim), `lib/raster` (pdf.js 300 DPI + text layer, EXIF, alpha → white, thumbnail), upload dialog (S3), Storage upload, `createSheet`, sheet list with search + paging + Trash/restore (S2), E2E test-user login helper | TC-08 – TC-19, TC-48, TC-52 | M1 |
| M4a | Editor core | Detection on the first open of a sheet in the editor (PDF text layer or M2 OCR) stored in `detections`; editor S4: zoom/pan, markers, popover (old value confirm, new value), revert, box tightening to the digits (UC-04 step 5, moved from M2), `lib/compose` (mask with sampled background + Arimo text at angle), save with conflict dialog S6, offline retry, unsaved-changes guard | TC-21, 23, 25 (load half), 26 – 29, 31 (revert as data), 33, 37 – 41 | M2, M3 |
| M4b | Editor tools | Read on click, Draw box (K), matching-value suggestion, rename, typed Worker errors, visual tests | TC-24, 30 – 32, 34 – 36 | M4a |
| M5 | Export | Pre-export check S5, PNG at source resolution, single-page PDF via pdf-lib (no text layer), file naming, `log_client_event` | TC-42 – TC-47 | M4 |
| M6 | Admin area | `/admin` layout guard; S7 users (role, suspend), S8 access + settings, S9 audit log with filters + CSV (UTF-8 BOM), S10 Trash + permanent delete (typed confirm, service-role file delete) + orphan clean-up | TC-54 – TC-77 (TC-60 concurrency via two connections) | M1, M3 |
| M7 | Hardening and release | Full E2E run, visual regression on Windows + macOS (TC-47), WCAG AA pass, dark mode check, Vercel production deploy, user guide (VI/EN), first Admin assigned | All 77 test cases green or explicitly waived by the owner; production sign-in works | M1–M6, Prerequisite 4 |

**Change 2026-10-08:** password sign-in for accounts an Admin creates (plan `2026-10-08-password-sign-in.md`); Google sign-in moves to a later milestone and will run side by side. Part of UC-13 (create accounts, issue passwords) moves forward from M6.

### M2 result (2026-10-07)

Measured in Chromium on the office PC with the bench page: scan located 9/11 (read 7/11) in about 17 s,
slowest click 4.2 s, clicks read 8/11 — TC-20 and TC-24 pass, matching the Python benchmark. Decision:
keep PP-OCRv4 small. Details: `research/ocr-bakeoff/README.md`, round 3.

### M3 result (2026-10-08)

Built: the sheet list (`/sheets`: 50 rows per load with infinite scroll and a "Load more" button,
search 300 ms after typing, Trash tab, Move to Trash with Undo, Restore, keyboard tabs and menu);
upload in the browser (checks type and size, renders PDF page 1 at 300 DPI with pdf.js 6.4.299 or an
image with EXIF orientation, flattens transparency on white, trims near-white borders, checks the
1.294 ratio, makes a 480-px JPEG thumbnail, uploads the original and thumbnail to Supabase Storage,
then the server checks both files and creates the row); and a read-only sheet page `/sheets/<id>`
that repeats the same render and trim. Migration `0003_sheet_list.sql` adds the `sheet_list` view
(security invoker), `list_sheets()` and `sheet_counts()`.

Tests: SQL 49 (7 new), unit 142, end-to-end 9 (TC-08, 09, 12, 15, 16, 18, 19, 48, 52; Playwright
1.63.0). TC-10, 11, 13, 14 and 17 are unit tests; TC-17 because the generator cannot encrypt PDFs.

Carried into M4: detection on upload (OCR or PDF text layer) stored in `detections`; the editor on
`/sheets/<id>`; rename through save; list paging takes about 2 s per 50 rows against the development
project from the office, so profile and parallelise the server reads. The M3 final fixes already
removed the redundant page refresh after list actions and made the list reads run in parallel; the
timing above was measured before them and has not been re-measured.

### M4a result (2026-10-08)

Commits `f18fa9b..11cde25` on branch `feat/m4a-editor`: the editor on
`/sheets/<id>` with detection on first open (version 1 to 2, also when nothing is found), markers,
locked zones, zoom, the edit popover, revert, composing the new value over the masked old one, save
with the conflict dialog, offline retry and the leave guard.

Measured: unit tests 34 files, 196 tests passing; SQL tests 6 files, 51 tests passing (`npm test` total 40 files, 247 tests); end-to-end 23 tests passing (full run 4.7 minutes on
the office PC). OCR on the synthetic 300-DPI image sheet found 11 of 11 values, 12–65 s from upload
to the stored detection on the office PC; the text-layer PDF finds all 11 without OCR. The 3-second
reopen (NFR-01) is to be confirmed on a production build in M7; the development server measured
3.1–4.4 s for a cold reopen.

### M4b result (2026-10-09)

Commits `git log --oneline e9c017b..HEAD` on branch `feat/m4b-editor-tools`: read on click, Draw box
(key `K`) with the angle choice, the offer to apply a change where the same value appears, renaming
from the editor toolbar and saving the name, typed reader failures with their own messages, and the
visual tests.

Measured: unit tests 35 files, 213 tests passing; end-to-end 35 tests passing (full run 9.7 minutes on
the office PC). The SQL suites were not run on this network (the Postgres pooler port is blocked), so
no new SQL count is given; M4b added no migration. TC-24: a click is read 1.7 to 1.9 s from the reader
being ready to the popover (limit 5 s). TC-30: 1235 pixels changed, 0 outside the mask, 0 on the
dimension line. TC-36: a value marked at 58 degrees was redrawn at 56.2 degrees (tolerance 4 degrees).
On a sheet whose values all come from the PDF text layer the reader is not warmed up in advance, so
the first click there starts it; on other sheets the reader starts with the first detection or shortly
after the page opens.

### Carried into M5 and later from M4a and M4b

- Box and colour sampling: prefer the run nearest the centre when two run counts are within 2x; state the half-pixel convention in the doc comment of the box helpers.
- Detection: create the OCR client inside the `try` so a Worker constructor that throws is reported as an OCR load error; handle a dimension split over several text-layer runs.
- Saving and loading: a stored value that fails the schema loads as unknown rather than broken; a refused save under a future RLS deny would read as a conflict; add tests for the schema bounds (confidence, angle, cx, string and array input, long ids) and for the save-result mapping.
- Editor screen: the load effect resets the base state whenever it re-runs, so tie it to unmount or to the sheet id; Stay or `Esc` pressed in the conflict dialog while "Load latest" runs should be ignored or the load cancelled; the popover has no vertical clamp; focus returns to the marker, not the list row; the leave guard misses Back/Forward and server-action posts.
- Reader and tools: the same alert shown twice in a row is announced once (key each notice); the reader hook ignores a changed `page` once it is starting; add unit tests for the reader's failure classification and the hook (needs a React test renderer; the end-to-end tests cover them for now); a click while a popover is open both closes it and reads, so keep that decision under test.
- Tests: add cases for negative-zero guards, a 180° run, a 30° text line, a box off the page, a run pushed out by the trim offset, tightening to ink in the text layer, a vertical edit and OCR with no detections; compare floats with a tolerance; make the end-to-end version wait tolerate a skipped version; move the value that sits in the drawn frame (3.39) out of the frame; add exact-edge tests for the drawing-area checks and a corner-containment check for the 58-degree box; make the stale-prompt test and the TC-34, TC-35 and TC-32 assertions stricter (no popover, wait for absence, a tighter match for the value 1); read the canvas box once in the drag helpers; remove the console output beside the TC-24 timing.
- Copy: Vietnamese wording of the detecting text ("up to a minute"), the "detected" state and the matching prompt (title, "this place only", the Draw box hint "Press Esc to cancel", one spelling of "huỷ/hủy").
- Code: share the trim/replace of the dimension helpers; use `hourCycle: "h23"` in the clock helper; derive the baseline from the box height; the font check cannot tell Arimo from a same-metric fallback; the runtime is fetched inside the inference session creation, so an offline start reads as an init failure.
- M7: confirm the 3-second reopen and the 5-second read on click on a production build.

### M5 result (2026-10-09)

Commits `git log --oneline f8ce215..HEAD` on branch `feat/m5-export`: the export file names, the PDF
page layout and the pre-export suggestions; rendering, encoding and downloading the export in the
browser, with the export log entry; the Export menu and the pre-export check; and the end-to-end tests
that open the exported files.

Measured: unit tests 36 files, 220 tests passing; end-to-end 41 tests passing (full run 14.6 minutes on
the office PC). The SQL suites were not run on this network (the Postgres pooler port is blocked), so
no new SQL count is given; M5 added no migration. TC-42: PDF export takes 1.6 s from pressing Export to
the download (limit 5 s); the exported PDFs have 1 page, 792 × 612 pt and no text items. TC-44: the
exported PNG's pixels equal the editor canvas (SHA-256 of the RGBA bytes). TC-47 (the same render on
Windows and macOS) stays with M7, because it needs a macOS machine.

### Carried into M5 and later from the M5 export work

- Export rendering: check the canvas height as well as the width after rendering, and turn any error thrown while painting or encoding into the "file could not be rendered" message; replace C1 control characters and bidirectional marks in file names, and cap the name stem at about 150 characters; add a test for two edits that share an old value but have different new values.
- Export dialog: paint the "Preparing the file" text before the rendering starts (wait one animation frame); do not open the read-on-click popover while an export is running, so it cannot appear behind the dialog; the dialog's `Esc` handling should ignore keys already handled by another layer; check that `Shift+Tab` from the dialog's first control behaves like `Tab` from its last; add a test that "Apply there too" in the dialog also skips values that were edited.
- M7: TC-47 on macOS (still open: needs a macOS machine). Confirm the 5-second PDF export on a production build: **Resolved in M7a** (1265 ms; see the M7a result).
- Also in this list: the export dialog's `Shift+Tab` from the first control behaves like `Tab` from the last: **Resolved in M7a** (`e2e/export.spec.ts`, Shift+Tab test).

### M6 result (2026-10-09)

Commits `git log --oneline 50b5a0f..HEAD` on branch `feat/m6-admin`: the plan; the audit filter, the CSV
builder, the orphan selection and the permanent-deletion sequence; the Admin navigation and the desktop
notice; the users list with role changes and suspension; the permitted domains and emails with account
counts, and the system settings; the audit log with its CSV; permanent deletion with typed confirmation and
the orphan clean-up; the fixes found on the way; and the end-to-end tests of the whole area.

Measured: unit tests 40 files, 249 tests passing; end-to-end 50 tests passing (full run 18.8 minutes on
the office PC; the Admin spec alone, 9 tests, 5.0 minutes). The SQL suites were not run on this network
(the Postgres pooler port is blocked), so no new SQL count is given. The Admin end-to-end tests change
shared state (settings, the access lists, a second account's role and status) and restore it; the
README lists what they touch.

Decisions taken during M6 (also in the design, UC-14, UC-16 and UC-17):

- Permanent deletion removes the record first, in one statement that also checks the sheet is in the
  Trash, and only then deletes the files, with two attempts. Files that cannot be deleted are reported and
  become an orphan folder for the clean-up. This replaces "files first; a retry deletes what remains".
- The permitted lists gate only Google sign-ins; password accounts an Admin created are always admitted.
  The account counts and the "will lose access" warning therefore count only Google accounts, and the
  warning counts those matched by that entry and by no other.
- The audit CSV is a snapshot: rows up to the newest entry when the export starts, stopping at 50,000.
  Cells that a spreadsheet could read as a formula are written as plain text.
- The Admin area needs a window at least 1024 px wide.

### Carried into M7 from the M6 admin work

- Desktop notice (**Resolved in M7a**: decision 2026-10-09, the reads stay; see the M7a result): below 1024 px the notice is only hidden by style; the server still reads the page's data on a phone. Skip the reads for narrow windows, or accept the cost and note it.
- Copy (**Resolved in M7a**: closed without a change, see the M7a result): the English wording of the unknown-error message on the users page.
- Orphan clean-up: when a batch of deletions fails midway, log the folders that were actually removed; when nothing was removed, say "none" instead of "Cleaned up 0"; show 1048575 bytes as "1.0 MB" and not "1024.0 KB".
- Permanent deletion (the unreachable "forbidden" branch: **Resolved in M7a**, commit 9d6829d): remove the unreachable "forbidden" branch in the error mapping; move focus sensibly after a successful deletion (the row is gone) and when the orphan confirmation dialog closes; confirm there are tests for the accent-composed (NFC) name match and for the restore-at-the-same-moment case.
- End-to-end run (**Resolved in M7a**: the 40-minute `globalTimeout` was already in `playwright.config.ts`; only the README still said 25 minutes, and M7a corrected it): the whole run now takes 18.8 minutes against a 25-minute limit in `playwright.config.ts`; raise the limit before the suite grows further.
- SQL: run the SQL suites for the Admin functions (TC-56 to TC-61, TC-65, TC-69 to TC-71, TC-73) from a network that reaches the pooler port.

### M7a result (2026-10-10)

Commits `git log --oneline 1c3a455..HEAD` on branch `feat/m7a-hardening`:

- security: the Content-Security-Policy with a per-request script nonce (70c3b87);
- release: the production-build test mode with the NFR-01 timings, and the build check that the secret key is not in the bundle (e51632d);
- editor: load once per sheet, ask before Back, Forward or Sign out, steady focus, notices and outside clicks (74f0516, 99bd7c6, dec83a3);
- editor: a value split in the text layer is read as one, and the run nearest the centre wins a close call; edge tests (d035420, c5b0420);
- Admin: the unreachable "forbidden" result removed, every error message says what to do next, and the design records the Admin-window decision (9d6829d, 7e03e4f, 269793d);
- tests: restores in the Admin tests, sign-in return, sign-out and Back, narrow screens, expired links, TC-60 (4efefc8 to f6b91aa);
- guide: an in-app user guide in Vietnamese and English with screenshots (db1c61f to cd03f77);
- accessibility: WCAG 2.2 AA scans in both themes and a keyboard-only journey, with the contrast fixes they found (a25e3b7 to 1b0030e);
- this task: the test-case status, the dependency audit and the documentation.

Measured: unit tests 45 files, 295 tests passing; end-to-end 89 tests on the production build (88 passed in
the full run of 20.5 minutes; one test failed because of a mistake in the test and passed after its fix,
with the whole `admin` spec, 9 tests, 3.1 minutes, passing again). The SQL suites were not run on this
network (the Postgres pooler port is blocked); TC-60 is new and has never run, so it must run on the
office network before the merge. Timings on the production build (NFR-01):

```
[timing] reopen-1 1857 ms
[timing] reopen-2 1848 ms
[timing] reopen-3 2372 ms
[timing] read-on-click 916 ms
[timing] export-pdf 1265 ms
```

Status of every test case: [`docs/testing/test-case-status.md`](../testing/test-case-status.md).

Decisions taken during M7a (also in the design):

- The Admin area hides itself below 1024 px with a notice, but its server reads still run on a narrow window, by decision 2026-10-09. Admins are few, every read is paged, and RLS applies. No code change.
- The CSP lives in `src/lib/security/csp.ts` and is set by `src/proxy.ts` with a new nonce for each request.
- Sign out ends only the session on that computer (`scope: "local"`), not every session of the person.
- pdf.js 6 has no `isEvalSupported` option and no `new Function` probe, so nothing needed switching off.
- The guide's images live in `src/app/(app)/guide/shots/<locale>/`, so each image is served once.

Carried items closed without a change:

- The reader keeps its first page once it is starting, by design (documented in `use-value-reader.ts`).
- The reader hook has no unit test: the end-to-end tests cover it, and no React test renderer was added.
- Three items had no clear wording to act on: the "stale prompt" test, the "detected" and matching prompt copy, and the English unknown-error message on the users page. Kept as they are, for the owner to reword if wanted.
- A read on click while the export dialog is open: the dialog is modal and covers the canvas.

Left for M7b: the release (TC-54, the first Admin on production), TC-47 on a macOS machine, running the SQL
suites (TC-60 above all) from a network that reaches the pooler port, the Google sign-in cases TC-01, TC-02
and TC-64 once Google is switched on, and small open items such as a value like `2. 50` that pdf.js still
reads as two pieces.

### Carried into M3 and later from the M2 review

- M3 (sheet decode): composite transparency onto white before OCR; the Raster sent to the Worker is always opaque.
- M3: merge scan readings by box overlap instead of centre distance; clamp boxes to the page before converting them to the design's fractional boxes.
- M3/M4: Worker errors carry a typed code (model download, runtime download, init failed) mapped to dictionary strings (TC-25); time clicks on the main thread for TC-24; do not send clicks while a scan runs (or stop the scan by disposing the client).
- M4: tighten boxes to the digits before masking (UC-04 step 5); draw at the reading's `angle` along its `quad`.
- M4: `quad` keeps the detector's corner order, not the text's (for a tall or upside-down read its first edge is the text's height); derive the design's `{cx, cy, w, h}` from `quad` and `angle` with one tested helper. Cancelling a scan means disposing the client and starting a new one (models reload in about 2 s from cache).
- M7 (the CSP part is **Resolved in M7a**, commit 70c3b87; the licence-text and Safari notes stay for M7b): the nonce-based CSP must allow the Blob-URL runtime (`worker-src 'self' blob:`, `script-src blob:`, `'wasm-unsafe-eval'`); serve the runtime from a versioned folder with an immutable cache; ship the Apache-2.0 licence text with the models; gate `/dev/*` with `requireAdmin()` if ENABLE_DEV_PAGES is ever set in production; note that Safari (no COEP credentialless) runs OCR on one thread.

### Prerequisites carried into M2

- Before M2 relies on the database: the development Supabase project exists, migration 0001 is applied, the full SQL suite passes against it, and the repository secret DATABASE_URL is set; then make CI fail (not warn) when the SQL tests are skipped on push to main.

### Rough effort (one developer, focused days)

M1 3–4 · M2 3–5 · M3 3–4 · M4 5–7 · M5 2 · M6 4–5 · M7 2–3 → about 22–30 days. M2 and M4
carry the most uncertainty; the estimate is a planning aid, not a commitment.

## Risks and how each milestone retires them

| Risk | Retired in | How |
|---|---|---|
| Browser OCR too slow or less accurate than the Python benchmark | M2 | Measure on a real office PC before building the editor; fallback is Draw box only |
| Office PCs low on RAM (the test PC had 0.4 GB free) | M2 | Small models only; one Worker; release the session after scanning |
| Masking cuts into dimension lines | M4 | Box tightening rule + TC-30 pixel test |
| Fonts render differently across machines | M4/M7 | Ship Arimo as a web font; TC-47 |
| Old values leak through exported PDFs | M5 | Flattened export + TC-42 text extraction check |
| Privilege escalation (Staff → Admin) | M1 | No write policies on `profiles`; TC-57 |
| Pooler connection limits (15 session slots) | M1 | postgres.js only in scripts/tests with `max: 1`; runtime uses PostgREST |
