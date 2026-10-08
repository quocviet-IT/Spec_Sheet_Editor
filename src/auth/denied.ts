import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Logs auth.denied for an account that signed in but may not enter (BR-08, BR-14). Uses the secret key
 * because a refused account cannot write to the audit log itself. The person is turned away either way;
 * a missing audit row must not go unnoticed.
 */
export async function recordDenied(user: { id: string; email: string | null }, reason: string): Promise<void> {
  const { error } = await createSupabaseAdmin().from("audit_log").insert({
    actor_email: user.email,
    action: "auth.denied",
    target_type: "user",
    target_id: user.id,
    detail: { reason },
  });
  if (error) console.error("auth.denied was not written to audit_log:", error.message);
}
