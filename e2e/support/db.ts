import { createClient } from "@supabase/supabase-js";
import { need } from "./env";

/** The Supabase client with the secret key (bypasses RLS). Everything the harness does goes over HTTPS. */
export function admin() {
  return createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Removes every sheet the account created: the files first, then the rows. */
export async function deleteSheetsOf(userId: string): Promise<void> {
  const client = admin();
  const paths: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("spec_sheets")
      .select("id, source_path, thumb_path")
      .eq("created_by", userId)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`test sheets not read: ${error.message}`);
    for (const r of data) paths.push(r.source_path, r.thumb_path);
    if (data.length < 1000) break;
  }
  const bucket = client.storage.from("spec-sheets");
  for (let i = 0; i < paths.length; i += 500) {
    const { error } = await bucket.remove(paths.slice(i, i + 500));
    if (error) throw new Error(`test files not removed (rows kept so nothing is orphaned): ${error.message}`); // before the rows go
  }
  const { error } = await client.from("spec_sheets").delete().eq("created_by", userId);
  if (error) throw new Error(`test sheets not deleted: ${error.message}`);
}
