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
   (Admin → Users). If `createUser` reports the email already exists (a stray sign-up from when
   sign-ups were on), delete that user under Authentication → Users first. The app offers no email
   change; keep "Secure email change" on in Supabase.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit tests; SQL tests too when `DATABASE_URL` is set (always rolled back) |
| `npm run build` | Production build |
| `npm run e2e` | End-to-end tests (Playwright) against the development project; needs the dev server and `.env.local`; creates and cleans up the accounts `e2e-staff@ctyhp.vn` and `e2e-staff-b@ctyhp.vn` and their sheets |
| `npm run db:migrate` | Apply pending migrations |
| `npm run admin:create` | Create the first Admin (once) |

## End-to-end tests

`npm run e2e` runs the Playwright tests against the development project. It needs the dev server
running and `.env.local` filled in; when no dev server answers on port 3000, Playwright starts one.
`.env.local` must also set `E2E_DEV_PROJECT_REF` to the project ref of the development project; the
tests refuse to run unless the Supabase URL and the database user both name that ref. There are two reserved test accounts: `e2e-staff@ctyhp.vn` and `e2e-staff-b@ctyhp.vn` (the second
only for the two-person conflict test). The first run creates them and later runs reuse them; every
run resets both passwords to random values held only in memory. The run deletes only these accounts'
sheets: before the run, during it (after each test) and after it. The OCR test takes one to three
minutes.
TC-17 (password-protected PDF): the error mapping is unit-tested; the full upload path for a locked
PDF is not, because the test-file generator cannot encrypt PDFs.

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
