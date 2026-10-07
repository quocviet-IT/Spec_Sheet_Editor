import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

/**
 * Secret-key client: bypasses RLS. Allowed uses only (NFR-10): logging rejected sign-ins, deleting files on
 * permanent deletion, listing and deleting orphan files. Never import from a client component.
 */
export function createSupabaseAdmin() {
  const env = getEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
