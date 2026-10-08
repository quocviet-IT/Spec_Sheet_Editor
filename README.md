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
   enabled and turn **off** "Allow new users to sign up": accounts are created only by an Admin
   (the admin API ignores this switch). Turn off Phone and Anonymous sign-ins. Under URL
   Configuration list only exact callback URLs (`http://localhost:3000/auth/callback`, later the
   production one) — needed once Google is switched on.
2. Google sign-in is optional and off by default (`GOOGLE_SIGN_IN=off`). To switch it on later:
   enable the Google provider, turn sign-ups back on (the database still admits only Google accounts
   on the permitted lists and accounts an Admin created), and set `GOOGLE_SIGN_IN=on`. The flag both
   shows the button and lets the app accept Google sign-ins; with `off` the server refuses them. Before
   switching on, check that Supabase links a Google identity to the existing account with the same
   verified email (Authentication → identity linking); otherwise the same person gets a second account.
3. `cp .env.example .env.local` and fill in the four required values (`GOOGLE_SIGN_IN` is optional).
4. `npm install`
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
| `npm run db:migrate` | Apply pending migrations |
| `npm run admin:create` | Create the first Admin (once) |

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
