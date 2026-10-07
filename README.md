# Spec Sheet Editor

Edit the dimension values on Product Specifications sheets and export a clean copy for customer
approval. Bilingual (Vietnamese / English).

- Design: [`docs/design/spec-sheet-editor-design.md`](docs/design/spec-sheet-editor-design.md)
  (HTML edition with wireframes: `docs/design/spec-sheet-editor-design.html`)
- Build roadmap and milestone plans: [`docs/plans/`](docs/plans/)
- OCR benchmark: [`research/ocr-bakeoff/`](research/ocr-bakeoff/)

## Stack

Next.js 16 · React 19 · Tailwind CSS 4 · Supabase (Postgres + RLS, Storage, Google Auth) · Vercel (`sin1`)

## Setup

1. Create a Supabase project in Singapore and enable the Google provider. Under Authentication → URL
   Configuration, list only exact callback URLs (no wildcards): `http://localhost:3000/auth/callback`
   now, and the production `https://<your-domain>/auth/callback` once deployed. The app builds the
   OAuth return address from the request, so this allow-list is what keeps sign-in on your own site.
2. Under Authentication → Providers keep only **Google** enabled; turn off Email, Phone and Anonymous
   sign-ins. The database refuses any session that did not come from Google, but switching the others
   off keeps sign-up forms closed.
3. `cp .env.example .env.local` and fill in the four values.
4. `npm install`
5. `npm run db:migrate` — applies `supabase/migrations/*.sql`.
   `DATABASE_URL` must point at the development project, never production: the SQL tests change data
   inside transactions that are always rolled back, but they are written for a disposable database.
6. `npm run dev`, sign in with a company Google account, then make yourself the first Admin in the
   Supabase SQL editor:
   ```sql
   update public.profiles set role = 'admin' where email = '<your-email>';
   ```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit tests; SQL tests too when `DATABASE_URL` is set (always rolled back) |
| `npm run build` | Production build |
| `npm run db:migrate` | Apply pending migrations |

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
