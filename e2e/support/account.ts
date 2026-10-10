import { randomBytes } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { admin } from "./db";

// These three addresses are reserved for tests; their passwords are reset at every run.
export const STAFF_EMAIL = "e2e-staff@ctyhp.vn";
export const STAFF_NAME = "E2E Staff";
export const STAFF_B_EMAIL = "e2e-staff-b@ctyhp.vn";
export const STAFF_B_NAME = "E2E Staff B";
export const ADMIN_EMAIL = "e2e-admin@ctyhp.vn";
export const ADMIN_NAME = "E2E Admin";

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
 * A reserved test account (Staff unless `role` says Admin): created once, then its password is replaced by a fresh random one at every
 * run (kept in memory only). It is a password account without a one-time password.
 */
export async function ensureAccount(email: string, name: string, role: "user" | "admin" = "user"): Promise<{ id: string; email: string; password: string }> {
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
    { id, email, full_name: name, role, password_account: true, must_change_password: false, status: "active" },
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
export const ensureAdmin = () => ensureAccount(ADMIN_EMAIL, ADMIN_NAME, "admin");

/** A fresh random password for a reserved account, set through the Auth admin API, for a sign-in inside a test. */
export async function resetPassword(email: string): Promise<string> {
  if (![STAFF_EMAIL, STAFF_B_EMAIL, ADMIN_EMAIL].includes(email)) throw new Error(`${email} is not a reserved test account`);
  const password = randomBytes(18).toString("base64url");
  const { error } = await admin().auth.admin.updateUserById(await accountId(email), { password });
  if (error) throw new Error(`test account password not reset: ${error.message}`);
  return password;
}

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
export const adminId = () => accountId(ADMIN_EMAIL);

/** Puts a reserved account back to Staff and active (the Admin tests change both). */
export async function restoreStaff(email: string): Promise<void> {
  if (email !== STAFF_EMAIL && email !== STAFF_B_EMAIL) throw new Error(`${email} is not a reserved Staff account`);
  const id = await accountId(email);
  // Retried: this runs in `finally` blocks, where one dropped connection would hide the test's own failure.
  let message = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await admin().from("profiles").update({ role: "user", status: "active" }).eq("id", id);
    if (!error) return;
    message = error.message;
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`test account not restored: ${message}`);
}

/**
 * Suspends the reserved Admin so it is never left active between runs (global setup makes it active again).
 * The database refuses to leave no active Admin; the real Admin account is active, so this is allowed.
 */
export async function suspendAdmin(): Promise<void> {
  const id = await accountId(ADMIN_EMAIL);
  let message = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await admin().from("profiles").update({ status: "suspended" }).eq("id", id);
    if (!error) return;
    message = error.message;
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error(`test Admin not suspended: ${message}`);
}

/** Fills the password sign-in form on the page and submits it (not the language switch forms); the caller waits for the landing page. */
export async function submitSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("form", { has: page.locator("#password") }).locator('button[type="submit"]').click();
}

/**
 * Signs a reserved account in again with a fresh password and saves the session to `statePath`. A new password ends the
 * account's saved sessions, so every test that resets one calls this afterwards, whatever else happened, to keep the
 * shared file valid for the other specs.
 */
export async function resign(browser: Browser, email: string, statePath: string, viewport = { width: 1440, height: 900 }): Promise<void> {
  const password = await resetPassword(email);
  const context = await browser.newContext({ baseURL: "http://localhost:3000", viewport });
  try {
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(30_000);
    const page = await context.newPage();
    await page.goto("/login");
    await submitSignIn(page, email, password);
    await page.waitForURL("**/sheets");
    await context.storageState({ path: statePath });
  } finally {
    await context.close();
  }
}

/** Runs every restore even when one fails, then reports all the failures together. */
export async function restoreAll(steps: (() => Promise<unknown>)[]): Promise<void> {
  const results = await Promise.allSettled(steps.map((step) => step()));
  const failures = results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
  if (failures.length > 0) throw new AggregateError(failures, `${failures.length} of ${steps.length} restores failed`);
}
