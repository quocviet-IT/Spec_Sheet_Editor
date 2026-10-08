import { randomBytes } from "node:crypto";
import { admin, db } from "./db";

// Both addresses are reserved for tests; their passwords are reset at every run.
export const STAFF_EMAIL = "e2e-staff@ctyhp.vn";
export const STAFF_NAME = "E2E Staff";
export const STAFF_B_EMAIL = "e2e-staff-b@ctyhp.vn";
export const STAFF_B_NAME = "E2E Staff B";

/**
 * A reserved test Staff account: created once, then its password is replaced by a fresh random one at every
 * run (kept in memory only). It is a password account without a one-time password.
 */
export async function ensureAccount(email: string, name: string): Promise<{ id: string; email: string; password: string }> {
  const password = randomBytes(18).toString("base64url");
  const sql = db();
  try {
    const [existing] = await sql<{ id: string }[]>`select id from auth.users where email = ${email}`;
    let id = existing?.id;
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
    const [u] = await sql<{ encrypted_password: string }[]>`select encrypted_password from auth.users where id = ${id}`;
    await sql`insert into public.profiles (id, email, full_name, role, password_account, must_change_password, status)
              values (${id}, ${email}, ${name}, 'user', true, false, 'active')
              on conflict (id) do update set must_change_password = false, status = 'active', role = 'user', full_name = excluded.full_name`;
    await sql`insert into public.password_snapshots (user_id, hash) values (${id}, ${u.encrypted_password})
              on conflict (user_id) do update set hash = excluded.hash, taken_at = now()`;
    return { id, email, password };
  } finally {
    await sql.end();
  }
}

export const ensureStaff = () => ensureAccount(STAFF_EMAIL, STAFF_NAME);
export const ensureStaffB = () => ensureAccount(STAFF_B_EMAIL, STAFF_B_NAME);

export async function accountId(email: string): Promise<string> {
  const sql = db();
  try {
    const [u] = await sql<{ id: string }[]>`select id from auth.users where email = ${email}`;
    if (!u) throw new Error(`test account ${email} missing; global setup did not run`);
    return u.id;
  } finally {
    await sql.end();
  }
}

export const staffId = () => accountId(STAFF_EMAIL);
export const staffBId = () => accountId(STAFF_B_EMAIL);
