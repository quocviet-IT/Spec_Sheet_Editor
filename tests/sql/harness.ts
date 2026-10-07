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

/** Switches the transaction to the `authenticated` role with this user's Google-session JWT claims. */
export async function actAs(tx: Tx, user: { id: string; email: string }): Promise<void> {
  const claims = { sub: user.id, email: user.email, role: "authenticated", app_metadata: { provider: "google", providers: ["google"] } };
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

/** A fresh address on the default permitted domain. */
export function staffEmail(): string {
  return `t-${randomUUID().slice(0, 8)}@ctyhp.vn`;
}

export async function closeDb(): Promise<void> {
  await sql?.end();
}
