import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { ensureStaff } from "./support/account";
import { deleteSheetsOf } from "./support/db";

export default async function globalSetup(): Promise<void> {
  const staff = await ensureStaff();
  await deleteSheetsOf(staff.id);
  await mkdir("e2e/.auth", { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: "http://localhost:3000" });
    page.setDefaultTimeout(30_000);
    await page.goto("/login");
    await page.locator("#email").fill(staff.email);
    await page.locator("#password").fill(staff.password);
    await page.locator("form", { has: page.locator("#password") }).locator('button[type="submit"]').click(); // not the language switch forms
    await page.waitForURL("**/sheets", { timeout: 30_000 });
    await page.context().storageState({ path: "e2e/.auth/staff.json" });
  } finally {
    await browser.close();
  }
}
