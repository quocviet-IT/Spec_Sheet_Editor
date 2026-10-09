import { chromium, type Browser } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { ensureAdmin, ensureStaff, ensureStaffB } from "./support/account";
import { deleteSheetsOf } from "./support/db";

async function signIn(browser: Browser, account: { email: string; password: string }, path: string): Promise<void> {
  const page = await browser.newPage({ baseURL: "http://localhost:3000" });
  try {
    page.setDefaultTimeout(30_000);
    await page.goto("/login");
    await page.locator("#email").fill(account.email);
    await page.locator("#password").fill(account.password);
    await page.locator("form", { has: page.locator("#password") }).locator('button[type="submit"]').click(); // not the language switch forms
    await page.waitForURL("**/sheets", { timeout: 30_000 });
    await page.context().storageState({ path });
  } finally {
    await page.close();
  }
}

export default async function globalSetup(): Promise<void> {
  const staff = await ensureStaff();
  const staffB = await ensureStaffB();
  const adminAccount = await ensureAdmin();
  await deleteSheetsOf(staff.id);
  await deleteSheetsOf(staffB.id);
  await deleteSheetsOf(adminAccount.id);
  await mkdir("e2e/.auth", { recursive: true });
  const browser = await chromium.launch();
  try {
    await signIn(browser, staff, "e2e/.auth/staff.json");
    await signIn(browser, staffB, "e2e/.auth/staff-b.json");
    await signIn(browser, adminAccount, "e2e/.auth/admin.json");
  } finally {
    await browser.close();
  }
}
