import { randomBytes } from "node:crypto";
import { admin, db } from "./db";

export const STAFF_EMAIL = "e2e-staff@ctyhp.vn";

/**
 * The test Staff account (e2e-staff@ctyhp.vn is reserved for tests; its password is reset at every run): created once, then its password is replaced by a fresh random one at every
 * run (kept in memory only). It is a password account without a one-time password.
 */
export async function ensureStaff(): Promise<{ id: string; email: string; password: string }> {
  const password = randomBytes(18).toString("base64url");
  const sql = db();
  try {
    const [existing] = await sql<{ id: string }[]>`select id from auth.users where email = ${STAFF_EMAIL}`;
    let id = existing?.id;
    if (!id) {
      const { data, error } = await admin().auth.admin.createUser({
        email: STAFF_EMAIL, password, email_confirm: true, user_metadata: { full_name: "E2E Staff" },
      });
      if (error || !data.user) throw new Error(`test account not created: ${error?.message}`);
      id = data.user.id;
    } else {
      const { error } = await admin().auth.admin.updateUserById(id, { password });
      if (error) throw new Error(`test account password not reset: ${error.message}`);
    }
    const [u] = await sql<{ encrypted_password: string }[]>`select encrypted_password from auth.users where id = ${id}`;
    await sql`insert into public.profiles (id, email, full_name, role, password_account, must_change_password, status)
              values (${id}, ${STAFF_EMAIL}, 'E2E Staff', 'user', true, false, 'active')
              on conflict (id) do update set must_change_password = false, status = 'active', role = 'user'`;
    await sql`insert into public.password_snapshots (user_id, hash) values (${id}, ${u.encrypted_password})
              on conflict (user_id) do update set hash = excluded.hash, taken_at = now()`;
    return { id, email: STAFF_EMAIL, password };
  } finally {
    await sql.end();
  }
}

export async function staffId(): Promise<string> {
  const sql = db();
  try {
    const [u] = await sql<{ id: string }[]>`select id from auth.users where email = ${STAFF_EMAIL}`;
    if (!u) throw new Error("test account missing; global setup did not run");
    return u.id;
  } finally {
    await sql.end();
  }
}
