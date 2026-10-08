import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import { signInErrorCode } from "./errors";

/**
 * Checks a password against Supabase WITHOUT touching the person's own session cookies: a separate,
 * stateless client signs in and that one session is ended again. "unavailable" means the check could
 * not be made (rate limit), which is not the same as a wrong password.
 */
export async function passwordIsCurrent(email: string, password: string): Promise<"ok" | "wrong" | "unavailable"> {
  const env = getEnv();
  const verifier = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await verifier.auth.signInWithPassword({ email, password });
  if (error) return signInErrorCode(error) === "rate_limited" ? "unavailable" : "wrong";
  const { error: outError } = await verifier.auth.signOut({ scope: "local" });
  if (outError) console.error("could not end the password check session:", outError.message);
  return "ok";
}
