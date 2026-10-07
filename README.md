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
2. `cp .env.example .env.local` and fill in the four values.
3. `npm install`
4. `npm run db:migrate` — applies `supabase/migrations/*.sql`.
5. `npm run dev`, sign in with a company Google account, then make yourself the first Admin in the
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

## Data rules

This repository is public. Never commit real sheets, order numbers or keys: `samples/` and
`.env*.local` are ignored on purpose.
