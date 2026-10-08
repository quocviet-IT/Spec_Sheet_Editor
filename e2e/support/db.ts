import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { need } from "./env";

export function db() {
  return postgres(need("DATABASE_URL"), { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });
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
    const bucket = admin().storage.from("spec-sheets");
    for (let i = 0; i < paths.length; i += 500) {
      const { error } = await bucket.remove(paths.slice(i, i + 500));
      if (error) throw new Error(`test files not removed (rows kept so nothing is orphaned): ${error.message}`); // before the rows go
    }
    await sql`delete from public.spec_sheets where created_by = ${userId}`;
  } finally {
    await sql.end();
  }
}
