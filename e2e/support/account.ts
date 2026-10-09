import { randomBytes } from "node:crypto";
import { admin } from "./db";

// Both addresses are reserved for tests; their passwords are reset at every run.
export const STAFF_EMAIL = "e2e-staff@ctyhp.vn";
export const STAFF_NAME = "E2E Staff";
export const STAFF_B_EMAIL = "e2e-staff-b@ctyhp.vn";
export const STAFF_B_NAME = "E2E Staff B";

/** The Auth user with this address (compared case-insensitively), or null; pages through the user list. */
async function findUserId(email: string): Promise<string | null> {
  const wanted = email.toLowerCase();
  const perPage = 200;
  for (let page = 1; ; page++) {
    const { data, error } = await admin().auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`test accounts not listed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (hit) return hit.id;
    if (data.users.length < perPage) return null;
  }
}

/**
 * A reserved test Staff account: created once, then its password is replaced by a fresh random one at every
 * run (kept in memory only). It is a password account without a one-time password.
 */
export async function ensureAccount(email: string, name: string): Promise<{ id: string; email: string; password: string }> {
  const password = randomBytes(18).toString("base64url");
  let id = await findUserId(email);
  if (!id) {
    const { data, error } = await admin().auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: name },
    });
    if (error || !data.user) throw new Error(`test account not created: ${error?.message}`);
    id = data.user.id;
  } else {
    const { error } = await admin().auth.admin.updateUserById(id, { password });
    if (error) throw new Error(`test account password not reset: ${error.message}`);
  }
  const profile = await admin().from("profiles").upsert(
    { id, email, full_name: name, role: "user", password_account: true, must_change_password: false, status: "active" },
    { onConflict: "id" },
  );
  if (profile.error) throw new Error(`test profile not saved: ${profile.error.message}`);
  // The password hash cannot be read over HTTPS, so an existing snapshot is left alone and a missing one gets a
  // placeholder. These reserved accounts never go through the one-time-password change, which is the only
  // reader of the snapshot.
  const snapshot = await admin().from("password_snapshots").select("user_id").eq("user_id", id).maybeSingle();
  if (snapshot.error) throw new Error(`test password snapshot not read: ${snapshot.error.message}`);
  if (!snapshot.data) {
    const inserted = await admin().from("password_snapshots").insert({ user_id: id, hash: "e2e-account" });
    if (inserted.error) throw new Error(`test password snapshot not saved: ${inserted.error.message}`);
  }
  return { id, email, password };
}

export const ensureStaff = () => ensureAccount(STAFF_EMAIL, STAFF_NAME);
export const ensureStaffB = () => ensureAccount(STAFF_B_EMAIL, STAFF_B_NAME);

const ids = new Map<string, string>();

/** Looked up once per address for the whole run (the account list is paged, and every test asks). */
export async function accountId(email: string): Promise<string> {
  const known = ids.get(email);
  if (known) return known;
  const id = await findUserId(email);
  if (!id) throw new Error(`test account ${email} missing; global setup did not run`);
  ids.set(email, id);
  return id;
}

export const staffId = () => accountId(STAFF_EMAIL);
export const staffBId = () => accountId(STAFF_B_EMAIL);
