/**
 * Applies supabase/migrations/NNNN_*.sql that are not yet recorded in public.schema_migrations.
 * Each file runs in its own transaction together with its bookkeeping row: all or nothing.
 * Uses the session pooler from DATABASE_URL (.env.local); one connection only.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (Supabase → Connect → Session pooler).");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const dir = path.join(process.cwd(), "supabase", "migrations");

try {
  await sql`create table if not exists public.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )`;
  await sql`alter table public.schema_migrations enable row level security`;

  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const done = new Set(
    (await sql<{ version: string }[]>`select version from public.schema_migrations`).map((r) => r.version),
  );

  let applied = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (done.has(version)) continue;
    const body = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.schema_migrations (version) values (${version})`;
    });
    console.log(`applied ${version}`);
    applied += 1;
  }
  console.log(applied ? `${applied} migration(s) applied` : "database is up to date");
} finally {
  await sql.end();
}
