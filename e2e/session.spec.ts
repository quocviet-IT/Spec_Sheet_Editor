import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { STAFF_B_EMAIL, STAFF_EMAIL, resetPassword, resign, restoreAll, staffBId, staffId, submitSignIn } from "./support/account";
import { admin, deleteSheetsOf } from "./support/db";
import { framedPng } from "./support/files";
import { uploadSheet } from "./support/sheets";

// Every test here starts signed out. A new password ends the account's saved sessions, so each test signs the
// account in again afterwards (`resign`) and the shared files stay valid for the other specs.
test.use({ storageState: { cookies: [], origins: [] } });

const STAFF_STATE = "e2e/.auth/staff.json";
const STAFF_B_STATE = "e2e/.auth/staff-b.json";

async function freshContext(browser: Browser, viewport = { width: 1280, height: 800 }): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: "http://localhost:3000", storageState: { cookies: [], origins: [] }, viewport });
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(30_000);
  return context;
}

async function signedIn(browser: Browser, email: string, password: string, viewport?: { width: number; height: number }): Promise<BrowserContext> {
  const context = await freshContext(browser, viewport);
  const page = await context.newPage();
  await page.goto("/login");
  await submitSignIn(page, email, password);
  await page.waitForURL("**/sheets");
  return context;
}

async function seedSheet(owner: string, name: string): Promise<string> {
  const id = randomUUID();
  const { error } = await admin().from("spec_sheets").insert({
    id, name, source_type: "png", source_path: `${id}/source.png`, thumb_path: `${id}/thumb.jpg`,
    page_px_w: 1135, page_px_h: 877, created_by: owner, updated_by: owner,
  });
  if (error) throw new Error(`test sheet not inserted: ${error.message}`);
  return id;
}

test("TC-06 a sheet link opened signed out leads to sign-in and back to the same sheet", async ({ browser }) => {
  const owner = await staffId();
  const id = await seedSheet(owner, `tc06-${randomUUID().slice(0, 8)}`);
  const context = await freshContext(browser);
  try {
    const password = await resetPassword(STAFF_EMAIL);
    const page = await context.newPage();
    await page.goto(`/sheets/${id}`);
    await expect(page).toHaveURL(/\/login/);
    await submitSignIn(page, STAFF_EMAIL, password);
    await expect(page).toHaveURL(new RegExp(`/sheets/${id}$`));
  } finally {
    await restoreAll([() => context.close(), () => deleteSheetsOf(owner), () => resign(browser, STAFF_EMAIL, STAFF_STATE)]);
  }
});

test("TC-07 after signing out, Back does not show the sheet list", async ({ browser }) => {
  const password = await resetPassword(STAFF_B_EMAIL);
  let context: BrowserContext | undefined;
  try {
    context = await signedIn(browser, STAFF_B_EMAIL, password);
    const page = context.pages()[0];
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.getByRole("button", { name: /^(Đăng xuất|Sign out)$/ }).click();
    await page.waitForURL("**/login");
    await page.goBack();
    await page.waitForLoadState("domcontentloaded");

    // Either the browser went to the sign-in page, or the list's heading and rows are not there.
    if (!/\/login/.test(page.url())) {
      await expect(page.getByRole("heading", { name: /^(Phiếu|Sheets)$/ })).toHaveCount(0);
      await expect(page.locator("li")).toHaveCount(0);
    }
  } finally {
    await restoreAll([async () => context?.close(), async () => deleteSheetsOf(await staffBId()), () => resign(browser, STAFF_B_EMAIL, STAFF_B_STATE)]);
  }
});

test("TC-07 signing out on one computer does not sign the person out on another", async ({ browser }) => {
  const password = await resetPassword(STAFF_B_EMAIL);
  const contexts: BrowserContext[] = [];
  try {
    contexts.push(await signedIn(browser, STAFF_B_EMAIL, password), await signedIn(browser, STAFF_B_EMAIL, password));
    const [first, second] = contexts.map((c) => c.pages()[0]);
    await first.getByRole("button", { name: /^(Đăng xuất|Sign out)$/ }).click();
    await first.waitForURL("**/login");
    await second.goto("/sheets");
    await expect(second).toHaveURL(/\/sheets$/);
    await expect(second.getByRole("heading", { level: 1 })).toBeVisible();
  } finally {
    await restoreAll([...contexts.map((c) => () => c.close()), () => resign(browser, STAFF_B_EMAIL, STAFF_B_STATE)]);
  }
});

test("TC-53 on a phone the editor shows its desktop notice and the list fits the screen", async ({ browser }) => {
  test.setTimeout(240_000); // one real upload
  const owner = await staffId();
  const password = await resetPassword(STAFF_EMAIL);
  let context: BrowserContext | undefined;
  try {
    context = await signedIn(browser, STAFF_EMAIL, password); // a desktop window, to upload a real sheet
    const page = context.pages()[0];
    const { id } = await uploadSheet(page, `tc53-${randomUUID().slice(0, 8)}.png`, "image/png", framedPng(1135, 877));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/sheets/${id}`);
    await expect(page.getByText(/cần màn hình máy tính|needs a desktop screen/)).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);

    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/sheets");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /Tải phiếu lên|Upload sheet/ }).first()).toBeVisible();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(fits, "the list must not scroll sideways").toBe(true);
  } finally {
    await restoreAll([async () => context?.close(), () => deleteSheetsOf(owner), () => resign(browser, STAFF_EMAIL, STAFF_STATE)]);
  }
});
