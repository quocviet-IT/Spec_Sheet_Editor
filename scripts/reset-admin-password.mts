/**
 * Issues a new one-time password to an Admin who can no longer sign in, printed once.
 *   npm run admin:reset-password -- <email>
 * For anyone else an Admin uses Admin → Users → Issue new password; this is the way back in when the only
 * Admin has lost their password. It does what that button does, over HTTPS only (no database port):
 * sets the password with the secret key (which also ends the account's sessions), marks the account so
 * the next sign-in must set a new password, and writes the audit entry. Run it in your own terminal, so
 * the password is seen by you alone.
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { generateTempPassword } from "../src/auth/password";

config({ path: ".env.local", quiet: true });

type Target = { id: string; email: string; role: string; status: string; password_account: boolean };

async function main(): Promise<number> {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("Usage: npm run admin:reset-password -- <email>");
    return 1;
  }
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } = process.env;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.");
    return 1;
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: target, error: readError } = await admin
    .from("profiles")
    .select("id, email, role, status, password_account")
    .eq("email", email) // stored in lower case; ilike would treat "_" in an address as a wildcard
    .maybeSingle<Target>();
  if (readError) throw new Error(`profile not read: ${readError.message}`);
  if (!target) {
    console.error(`No account with the email ${email}.`);
    return 1;
  }
  if (target.role !== "admin") {
    console.error("This account is not an Admin. An Admin issues its new password in the app: Admin → Users.");
    return 1;
  }
  if (!target.password_account) {
    console.error("This account signs in with Google, not with a password.");
    return 1;
  }

  const tempPassword = generateTempPassword();
  const { error: setError } = await admin.auth.admin.updateUserById(target.id, { password: tempPassword });
  if (setError) throw new Error(`password not set: ${setError.message}`);

  const { error: markError } = await admin
    .from("profiles")
    .update({ must_change_password: true, updated_at: new Date().toISOString() })
    .eq("id", target.id);
  if (markError) throw new Error(`account not marked for a password change: ${markError.message}`);

  // The snapshot holds the hash of the last password set, so a forced change can refuse to keep the one-time
  // password. The new hash cannot be read over HTTPS, so the stale snapshot is removed; Supabase Auth itself
  // still refuses a "new" password equal to the current one.
  const { error: snapshotError } = await admin.from("password_snapshots").delete().eq("user_id", target.id);
  if (snapshotError) throw new Error(`password snapshot not cleared: ${snapshotError.message}`);

  const { error: auditError } = await admin.from("audit_log").insert({
    action: "user.password_reset",
    target_type: "user",
    target_id: target.id,
    detail: { email: target.email, by: "reset script" },
  });
  if (auditError) throw new Error(`audit entry not written: ${auditError.message}`);

  console.log(`New one-time password for ${target.email} (shown once): ${tempPassword}`);
  if (target.status !== "active") console.log(`Note: this account is ${target.status}; it cannot sign in until it is reinstated.`);
  console.log("Sign in at /login; you will be asked to set your own password.");
  return 0;
}

// exitCode rather than process.exit(): exiting while the HTTP connections close trips a libuv assertion on Windows.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
