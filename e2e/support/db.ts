import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { need } from "./env";

export function db() {
  return postgres(need("DATABASE_URL"), { max: 1, prepare: false, onnotice: () => {} });
}

export function admin() {
  return createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Removes every sheet the account created: files with the secret key, rows as the table owner. */
export async function deleteSheetsOf(userId: string): Promise<void> {
  const sql = db();
  try {
    const rows = await sql<{ id: string; source_path: string; thumb_path: string }[]>`
      select id, source_path, thumb_path from public.spec_sheets where created_by = ${userId}`;
    const paths = rows.flatMap((r) => [r.source_path, r.thumb_path]);
    for (let i = 0; i < paths.length; i += 500) {
      await admin().storage.from("spec-sheets").remove(paths.slice(i, i + 500));
    }
    await sql`delete from public.spec_sheets where created_by = ${userId}`;
  } finally {
    await sql.end();
  }
}
