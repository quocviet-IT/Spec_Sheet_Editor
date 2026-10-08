/**
 * Creates the first Admin: a password account with a one-time password, printed once.
 *   npm run admin:create -- <email> "<Full name>"
 * Refuses when an active Admin already exists; later accounts are created in the app (Admin → Users).
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DATABASE_URL in .env.local.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { generateTempPassword } from "../src/auth/password";

config({ path: ".env.local", quiet: true });

async function main(): Promise<number> {
  const [emailArg, ...nameParts] = process.argv.slice(2);
  const email = (emailArg ?? "").trim().toLowerCase();
  const fullName = nameParts.join(" ").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !fullName) {
    console.error('Usage: npm run admin:create -- <email> "<Full name>"');
    return 1;
  }
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, DATABASE_URL: db } = process.env;
  if (!url || !key || !db) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DATABASE_URL in .env.local.");
    return 1;
  }

  const sql = postgres(db, { max: 1, prepare: false, onnotice: () => {} });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.profiles where role = 'admin' and status = 'active'`;
    if (n > 0) {
      console.error("An active Admin already exists. Create further accounts in the app: Admin → Users.");
      return 1;
    }
    const tempPassword = generateTempPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) {
      console.error(`The sign-in account was not created: ${error?.message ?? "no user returned"}`);
      return 1;
    }
    const id = data.user.id;
    try {
      await sql.begin(async (tx) => {
        const [u] = await tx<{ encrypted_password: string }[]>`select encrypted_password from auth.users where id = ${id}`;
        await tx`insert into public.profiles (id, email, full_name, role, password_account, must_change_password)
                 values (${id}, ${email}, ${fullName}, 'admin', true, true)`;
        await tx`insert into public.password_snapshots (user_id, hash) values (${id}, ${u.encrypted_password})`;
        await tx`insert into public.audit_log (actor_email, action, target_type, target_id, detail)
                 values (null, 'user.create', 'user', ${id},
                         ${tx.json({ email, role: "admin", sign_in: "password", by: "setup script" })})`;
      });
    } catch (e) {
      console.error("Registering the Admin failed:", e);
      try {
        const { error: deleteError } = await admin.auth.admin.deleteUser(id);
        if (deleteError) console.error(`Clean-up failed; delete ${email} under Authentication → Users:`, deleteError.message);
      } catch (cleanup) {
        console.error(`Clean-up failed; delete ${email} under Authentication → Users:`, cleanup);
      }
      throw e;
    }
    console.log(`First Admin created: ${email}`);
    console.log(`One-time password (shown once): ${tempPassword}`);
    console.log("Sign in at /login; you will be asked to set your own password.");
    return 0;
  } finally {
    await sql.end();
  }
}

process.exitCode = await main();
