import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect } from "vitest";

/** SQL tests run only when DATABASE_URL is configured (.env.local or a CI secret). */
export const hasDb = Boolean(process.env.DATABASE_URL);

const sql = hasDb ? postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} }) : null;

export type Tx = postgres.TransactionSql;
export type TestUser = { id: string; email: string };

const ROLLBACK = new Error("rollback");

/** Runs fn in a transaction that is always rolled back: tests never leave data behind. */
export async function rollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await sql!.begin(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

/** Creates an auth user and its profile as the table owner (bypassing RLS). */
export async function makeUser(tx: Tx, email: string, role: "user" | "admin" = "user"): Promise<TestUser> {
  const id = randomUUID();
  await tx`insert into auth.users (id, email, aud, role) values (${id}, ${email}, 'authenticated', 'authenticated')`;
  await tx`insert into public.profiles (id, email, full_name, role) values (${id}, ${email}, ${email.split("@")[0]}, ${role})`;
  return { id, email };
}

/** A Supabase Auth account only (no profile), as auth.admin.createUser leaves it. */
export async function makeSignInAccount(
  tx: Tx,
  email: string,
  opts: { provider?: "email" | "google"; hash?: string; createdAt?: Date } = {},
): Promise<TestUser & { hash: string }> {
  const id = randomUUID();
  const provider = opts.provider ?? "email";
  const hash = opts.hash ?? `test-hash-${id}`;
  await tx`insert into auth.users (id, email, aud, role, encrypted_password, raw_app_meta_data, created_at)
           values (${id}, ${email}, 'authenticated', 'authenticated', ${hash},
                   ${tx.json({ provider, providers: [provider] })}, ${opts.createdAt ?? new Date()})`;
  return { id, email, hash };
}

/** A password account an Admin created; `mustChange` means the one-time password is still in use. */
export async function makePasswordUser(
  tx: Tx,
  email: string,
  opts: { role?: "user" | "admin"; mustChange?: boolean } = {},
): Promise<TestUser & { hash: string }> {
  const account = await makeSignInAccount(tx, email);
  await tx`insert into public.profiles (id, email, full_name, role, password_account, must_change_password)
           values (${account.id}, ${email}, ${email.split("@")[0]}, ${opts.role ?? "user"}, true, ${opts.mustChange ?? false})`;
  // every real password account has a snapshot from the moment it is registered
  await tx`insert into public.password_snapshots (user_id, hash) values (${account.id}, ${account.hash})`;
  return account;
}

/** Switches the transaction to the `authenticated` role with this user's session JWT claims. */
export async function actAs(tx: Tx, user: { id: string; email: string }, provider: "google" | "email" = "google"): Promise<void> {
  const claims = { sub: user.id, email: user.email, role: "authenticated", app_metadata: { provider, providers: [provider] } };
  await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
  await tx`set local role authenticated`;
}

/** Back to the connection's own role (table owner), e.g. to arrange data. */
export async function actAsOwner(tx: Tx): Promise<void> {
  await tx`reset role`;
}

/** Runs fn inside a savepoint and asserts it fails with a message containing `message`. */
export async function expectError(tx: Tx, fn: (sp: Tx) => Promise<unknown>, message: string): Promise<void> {
  let error: unknown = null;
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp);
    });
  } catch (e) {
    error = e;
  }
  expect(error, `expected an error containing "${message}"`).not.toBeNull();
  expect(String((error as Error).message)).toContain(message);
}

/** Inserts a sheet with the current role (use after actAs to exercise RLS). */
export async function insertSheet(tx: Tx, owner: TestUser): Promise<string> {
  const id = randomUUID();
  await tx`insert into public.spec_sheets (id, name, source_type, source_path, thumb_path, page_px_w, page_px_h, created_by, updated_by)
           values (${id}, 'Test sheet', 'png', ${`${id}/source.png`}, ${`${id}/thumb.jpg`}, 1135, 877, ${owner.id}, ${owner.id})`;
  return id;
}

/** Inserts a sheet as the table owner (bypassing RLS), with a chosen name, time and number of edits. */
export async function insertSheetAsOwner(
  tx: Tx,
  owner: TestUser,
  opts: { name?: string; updatedAt?: Date; edits?: number } = {},
): Promise<string> {
  const id = randomUUID();
  const edits = Array.from({ length: opts.edits ?? 0 }, (_, i) => ({ id: `e${i}` }));
  await tx`insert into public.spec_sheets (id, name, source_type, source_path, thumb_path, page_px_w, page_px_h,
                                           edits, created_by, updated_by, updated_at)
           values (${id}, ${opts.name ?? "Test sheet"}, 'png', ${`${id}/source.png`}, ${`${id}/thumb.jpg`}, 1135, 877,
                   ${tx.json(edits)}, ${owner.id}, ${owner.id}, ${opts.updatedAt ?? new Date()})`;
  return id;
}

/** A fresh address on the default permitted domain. */
export function staffEmail(): string {
  return `t-${randomUUID().slice(0, 8)}@ctyhp.vn`;
}

export async function closeDb(): Promise<void> {
  await sql?.end();
}
