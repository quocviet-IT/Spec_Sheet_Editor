# Spec Sheet Editor

Edit the dimension values on Product Specifications sheets and export a clean copy for customer
approval. Bilingual (Vietnamese / English).

- Design: [`docs/design/spec-sheet-editor-design.md`](docs/design/spec-sheet-editor-design.md)
  (HTML edition with wireframes: `docs/design/spec-sheet-editor-design.html`)
- Build roadmap and milestone plans: [`docs/plans/`](docs/plans/)
- OCR benchmark: [`research/ocr-bakeoff/`](research/ocr-bakeoff/)

## Stack

Next.js 16 · React 19 · Tailwind CSS 4 · Supabase (Postgres + RLS, Storage, Auth: email + password; Google later) · Vercel (`sin1`)

## Setup

1. Create a Supabase project in Singapore. Under Authentication → Sign In / Providers keep **Email**
   enabled. Accounts are created only by an Admin (the admin API ignores the sign-up switch), so
   turning **off** "Allow new users to sign up" is recommended but not required: a self-made account
   gets a Supabase login but the database refuses it, because no Admin created it
   (`tests/sql/password.test.ts`). Turn off Phone and Anonymous sign-ins. Also turn on Secure password
   change (Authentication → Providers → Email): Supabase then asks a person who signed in long ago to
   sign in again before a password change, which the app explains. Under URL Configuration list only
   exact callback URLs (`http://localhost:3000/auth/callback`, later the production one) — needed once
   Google is switched on.
2. Google sign-in is optional and off by default (`GOOGLE_SIGN_IN=off`). To switch it on later:
   enable the Google provider, turn sign-ups back on (the database still admits only Google accounts
   on the permitted lists and accounts an Admin created), and set `GOOGLE_SIGN_IN=on`. The flag both
   shows the button and lets the app accept Google sign-ins; with `off` the server refuses them. Before
   switching on, check that Supabase links a Google identity to the existing account with the same
   verified email (Authentication → identity linking); otherwise the same person gets a second account.
3. `cp .env.example .env.local` and fill in the four required values (`GOOGLE_SIGN_IN` is optional).
4. `npm install`. `npm run ocr:build` (run by `predev` and `prebuild`) copies the OCR worker, the pdf.js worker and the Arimo font (OFL-1.1) into `public/`; the font goes to `public/fonts/arimo/`.
5. `npm run db:migrate` — applies `supabase/migrations/*.sql`.
   `DATABASE_URL` must point at the development project, never production: the SQL tests change data
   inside transactions that are always rolled back, but they are written for a disposable database.
6. Create the first Admin once: `npm run admin:create -- you@ctyhp.vn "Your Name"`. It prints a
   one-time password; sign in with it at `/login` and set your own password. Further accounts:
   Admin → Users.

   There is no self-service "forgot password": an Admin issues a new one-time password
   (Admin → Users). When the only Admin cannot sign in, run
   `npm run admin:reset-password -- you@ctyhp.vn` in your own terminal. It needs only HTTPS, prints a new
   one-time password once, ends that account's sessions and writes the audit entry. If `createUser` reports the email already exists (a stray sign-up from when
   sign-ups were on), delete that user under Authentication → Users first. The app offers no email
   change; keep "Secure email change" on in Supabase.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit tests; SQL tests too when `DATABASE_URL` is set (always rolled back) |
| `npm run build` | Production build; the `postbuild` step (`scripts/check-bundle.mts`) fails the build if the secret key, its name or its prefix appears in the browser bundle (TC-77) |
| `npm run e2e` | End-to-end tests (Playwright) against the development project; needs the dev server and `.env.local`; creates and cleans up the accounts `e2e-staff@ctyhp.vn`, `e2e-staff-b@ctyhp.vn` and `e2e-admin@ctyhp.vn` and their sheets |
| `npm run e2e:prod` | The same end-to-end suite against a production build (`next build` + `next start`), which also records the NFR-01 `[timing]` lines and checks the Content-Security-Policy. Stop any dev server on port 3000 first; Playwright starts its own server and never reuses one |
| `npm run guide:shots` | Captures the screenshots of the user guide into `src/app/(app)/guide/shots/<locale>/` (Vietnamese and English); rerun it after a screen that the guide shows changes, and look at the images before committing |
| `npm run db:migrate` | Apply pending migrations |
| `npm run admin:create` | Create the first Admin (once) |
| `npm run admin:reset-password` | New one-time password for an Admin who cannot sign in |

## End-to-end tests

`npm run e2e` runs the Playwright tests against the development project. It needs the dev server
running and `.env.local` filled in; when no dev server answers on port 3000, Playwright starts one.
`.env.local` must also set `E2E_DEV_PROJECT_REF` to the project ref of the development project; the
tests refuse to run unless the Supabase URL names that ref (and, when `DATABASE_URL` is set, its user does too).
The end-to-end tests need only HTTPS to Supabase, so they work from networks that block the Postgres
ports; the SQL unit tests still need `DATABASE_URL` and the pooler port. There are three reserved test accounts: `e2e-staff@ctyhp.vn`, `e2e-staff-b@ctyhp.vn` (the second
only for the two-person conflict test and the Admin tests that change another person) and
`e2e-admin@ctyhp.vn` (an Admin, used by the Admin tests). The first run creates them and later runs
reuse them; every run resets all three passwords to random values held only in memory. The run deletes only these accounts'
sheets: before the run, during it (after each test) and after it. The specs are `upload`, `list`, `detect`, `editor`, `tools`, `pixels`, `export`, `admin`, `session` (sign-in return, sign-out and Back, narrow screens), `storage` (expired links), `csp` (the security policy), `perf` (the NFR-01 timings), `a11y` (WCAG 2.2 AA scans in both themes), `keyboard` (a keyboard-only journey) and `guide`. A full run on the production build (`npm run e2e:prod`) took 20.5 minutes on 2026-10-10 (88 tests passed, and the one that failed was a mistake in the test, since fixed), so
`playwright.config.ts` allows 40 minutes for the whole run. Per-test results are in `docs/testing/test-case-status.md`.
The Admin tests change shared state and put it back: the four system settings (restored to their
previous values after the settings tests), the permitted domain and email lists (the test entries are
added and removed again), and the role and status of `e2e-staff-b@ctyhp.vn` (restored to an active
Staff account). They also write audit-log entries, which stay, because the log is append-only. Do not run
them against a project where someone is using those settings.
TC-17 (password-protected PDF): the error mapping is unit-tested; the full upload path for a locked
PDF is not, because the test-file generator cannot encrypt PDFs.

## Security headers

Every page response carries a Content-Security-Policy with a fresh script nonce for each request. It is built
by `buildCsp` in `src/lib/security/csp.ts` and set by `src/proxy.ts`; the fixed headers (for example
`Cross-Origin-Embedder-Policy`) are in `next.config.ts`. To allow a new third-party origin, add it to the right
directive in `buildCsp` (`connect-src` for requests, `img-src` for images, and so on), extend
`tests/unit/csp.test.ts`, and run `e2e/csp.spec.ts` on the production build: the policy is stricter in
production than in development, so a violation can show only there. Never add `'unsafe-inline'` to
`script-src`.

## Dependency audit

Checked on 2026-10-10.

- `npm audit --omit=dev` (what ships): `found 0 vulnerabilities`.
- `npm audit` (with development tools): `5 high severity vulnerabilities`, all in one chain:
  `braces` and `micromatch`, then `fast-glob`, `@next/eslint-plugin-next` and `eslint-config-next`. No fix
  exists that does not downgrade Next.js's ESLint configuration (`npm audit fix --force` would do that).
  These packages run only when ESLint runs on a developer's machine or in CI; they are never in the
  browser bundle or on the server. The owner can accept this risk; run both commands again at each release.

## Database migrations

Migrations in `supabase/migrations/` are applied once, in order, and recorded in
`public.schema_migrations`. A file that has been applied to any project is never edited again; fix
forward with the next number (`0002_…`).

## Continuous integration

GitHub Actions runs lint, typecheck, tests and build on every push to `main` and on pull requests.
To include the SQL tests, add the development project's session-pooler URL as the repository secret
`DATABASE_URL` (Settings → Secrets and variables → Actions). Without it the run shows a warning and
the SQL tests are skipped.

## Data rules

This repository is public. Never commit real sheets, order numbers or keys: `samples/` and
`.env*.local` are ignored on purpose.
