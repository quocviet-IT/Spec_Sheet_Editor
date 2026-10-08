import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import { signInErrorCode } from "./errors";

/**
 * Checks a password against Supabase WITHOUT touching the person's own session cookies: a separate,
 * stateless client signs in and that one session is ended again. Only a credentials error is "wrong";
 * anything else (rate limit, outage, unexpected failure) is "unavailable", never a wrong password.
 */
export async function passwordIsCurrent(email: string, password: string): Promise<"ok" | "wrong" | "unavailable"> {
  try {
    const env = getEnv();
    const verifier = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await verifier.auth.signInWithPassword({ email, password });
    if (error) return signInErrorCode(error) === "invalid" ? "wrong" : "unavailable";
    const { error: outError } = await verifier.auth.signOut({ scope: "local" });
    if (outError) console.error("could not end the password check session:", outError.message);
    return "ok";
  } catch (e) {
    console.error("password check failed:", e instanceof Error ? e.message : String(e));
    return "unavailable";
  }
}
