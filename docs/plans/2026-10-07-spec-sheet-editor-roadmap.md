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
   - *Authentication → Providers → Google:* enable, paste the Google OAuth client id/secret (step 2).
   - *Authentication → URL configuration:* Site URL `http://localhost:3000`; add redirect URLs
     `http://localhost:3000/auth/callback` and (later) `https://<vercel-domain>/auth/callback`.
   - *Authentication → Sign In / Providers:* turn **off** "Allow new users to sign up" for Email,
     leave Email provider **on** (used only by admin-created test users in E2E, M3+).
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
| M1 | Foundation | Next.js app, design tokens, bilingual shell, migration `0001_init.sql` (all tables, functions, triggers, RLS, bucket), migration runner, SQL test harness, Google sign-in, access guard, sign-out, CI | Unit tests green; `next build` green; SQL tests TC-03, 04, 05, 49, 50, 56, 57, 59, 61, 65, 69, 70, 71, 73 green against the dev project; manual sign-in with a `ctyhp.vn` account and rejection of a gmail account | Prerequisites 1–3 for the SQL tests and sign-in check |
| M2 | Browser OCR | `lib/ocr`: PP-OCRv4 small on onnxruntime-web in a Web Worker (pre/post-processing ported from RapidOCR: DB box decoding, CTC decoding), scan of the drawing area at 0° and 90° CW, read-on-click; `/dev/ocr-bench` page that scores the 11-value sample | TC-20 ≥ 9/11 located in ≤ 60 s and TC-24 ≤ 5 s **in Chrome on an office PC**; decision recorded: keep v4 small or switch to v6 small | M1 (app shell only); can start in parallel with M1 Tasks 4–7 |
| M3 | Sheets pipeline | `lib/form` (ratio, editable zone, trim), `lib/raster` (pdf.js 300 DPI + text layer, EXIF, alpha → white, thumbnail), upload dialog (S3), Storage upload, `createSheet`, sheet list with search + paging + Trash/restore (S2), E2E test-user login helper | TC-08 – TC-19, TC-48, TC-52 | M1 |
| M4 | Editor | Detection on upload (PDF text layer or M2 OCR) stored in `detections`; editor S4: zoom/pan, markers, popover (old value confirm, new value), Draw box (K), read-on-click, revert, matching-value suggestion; `lib/numbers`; box tightening to the digits (UC-04 step 5, moved from M2); `lib/compose` (mask with sampled background + Arimo text at angle); `save_sheet` with conflict dialog S6; unsaved-changes guard | TC-21 – TC-41 | M2, M3 |
| M5 | Export | Pre-export check S5, PNG at source resolution, single-page PDF via pdf-lib (no text layer), file naming, `log_client_event` | TC-42 – TC-47 | M4 |
| M6 | Admin area | `/admin` layout guard; S7 users (role, suspend), S8 access + settings, S9 audit log with filters + CSV (UTF-8 BOM), S10 Trash + permanent delete (typed confirm, service-role file delete) + orphan clean-up | TC-54 – TC-77 (TC-60 concurrency via two connections) | M1, M3 |
| M7 | Hardening and release | Full E2E run, visual regression on Windows + macOS (TC-47), WCAG AA pass, dark mode check, Vercel production deploy, user guide (VI/EN), first Admin assigned | All 77 test cases green or explicitly waived by the owner; production sign-in works | M1–M6, Prerequisite 4 |

### M2 result (2026-10-07)

Measured in Chromium on the office PC with the bench page: scan located 9/11 (read 7/11) in about 17 s,
slowest click 4.2 s, clicks read 8/11 — TC-20 and TC-24 pass, matching the Python benchmark. Decision:
keep PP-OCRv4 small. Details: `research/ocr-bakeoff/README.md`, round 3.

### Carried into M3 and later from the M2 review

- M3 (sheet decode): composite transparency onto white before OCR; the Raster sent to the Worker is always opaque.
- M3: merge scan readings by box overlap instead of centre distance; clamp boxes to the page before converting them to the design's fractional boxes.
- M3/M4: Worker errors carry a typed code (model download, runtime download, init failed) mapped to dictionary strings (TC-25); time clicks on the main thread for TC-24; do not send clicks while a scan runs (or stop the scan by disposing the client).
- M4: tighten boxes to the digits before masking (UC-04 step 5); draw at the reading's `angle` along its `quad`.
- M4: `quad` keeps the detector's corner order, not the text's (for a tall or upside-down read its first edge is the text's height); derive the design's `{cx, cy, w, h}` from `quad` and `angle` with one tested helper. Cancelling a scan means disposing the client and starting a new one (models reload in about 2 s from cache).
- M7: the nonce-based CSP must allow the Blob-URL runtime (`worker-src 'self' blob:`, `script-src blob:`, `'wasm-unsafe-eval'`); serve the runtime from a versioned folder with an immutable cache; ship the Apache-2.0 licence text with the models; gate `/dev/*` with `requireAdmin()` if ENABLE_DEV_PAGES is ever set in production; note that Safari (no COEP credentialless) runs OCR on one thread.

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
