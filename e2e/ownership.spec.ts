import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { STAFF_B_NAME, STAFF_NAME, staffBId, staffId } from "./support/account";
import { admin, deleteSheetsOf } from "./support/db";
import { openValuesSheet, searchSheets } from "./support/sheets";

const VIEWPORT = { width: 1440, height: 900 };

test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
  await deleteSheetsOf(await staffBId());
});

/** One sheet row for `owner`, without files (the list shows the thumbnail's placeholder). */
async function seedSheet(owner: string, name: string): Promise<string> {
  const id = randomUUID();
  const { error } = await admin().from("spec_sheets").insert({
    id, name, source_type: "png", source_path: `${id}/source.png`, thumb_path: `${id}/thumb.jpg`,
    page_px_w: 1135, page_px_h: 877, created_by: owner, updated_by: owner,
  });
  if (error) throw new Error(`test sheet not inserted: ${error.message}`);
  return id;
}

test("TC-78 BR-18 Staff see only their own sheets; another person's link is not found", async ({ browser }) => {
  const prefix = `own-${randomUUID().slice(0, 8)}`;
  const mine = `${prefix} alpha`;
  const theirs = `${prefix} bravo`;
  const mineId = await seedSheet(await staffId(), mine);
  await seedSheet(await staffBId(), theirs);
  const context = await browser.newContext({ storageState: "e2e/.auth/staff-b.json", viewport: VIEWPORT });
  try {
    const page = await context.newPage();
    await page.goto("/sheets");
    await searchSheets(page, prefix, 1);
    await expect(page.getByText(/Hiển thị 1–1 trong 1$|Showing 1–1 of 1$/)).toBeVisible();
    const rows = page.locator("#sheet-panel > ul > li");
    await expect(rows.first()).toContainText(theirs);
    await expect(page.getByText(mine, { exact: true })).toHaveCount(0);

    const res = await page.goto(`/sheets/${mineId}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText(/could not be found/i)).toBeVisible(); // the not-found page itself, should a loading screen ever stream first
    await expect(page.getByText(mine)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("TC-79 BR-18 an Admin sees every sheet with its creator, filters by creator and sees who uploaded", async ({ browser, page }) => {
  const prefix = `own-${randomUUID().slice(0, 8)}`;
  const mine = `${prefix} alpha`;
  const theirs = `${prefix} bravo`;
  const staffBIdValue = await staffBId();
  await seedSheet(await staffId(), mine);
  await seedSheet(staffBIdValue, theirs);

  // The sheet the editor check opens must have its original file, so e2e-staff uploads it.
  const uploaded = await openValuesSheet(page, `${prefix}-up`);

  const context = await browser.newContext({ storageState: "e2e/.auth/admin.json", viewport: VIEWPORT });
  try {
    const adminPage = await context.newPage();
    await adminPage.goto("/sheets");
    await searchSheets(adminPage, prefix, 3);
    const rows = adminPage.locator("#sheet-panel > ul > li");
    await expect(rows.filter({ hasText: mine })).toContainText(new RegExp(`(của|by) ${STAFF_NAME}(?! B)`));
    await expect(rows.filter({ hasText: theirs })).toContainText(new RegExp(`(của|by) ${STAFF_B_NAME}`));

    await adminPage.getByLabel(/Người tạo|Creator/).selectOption(staffBIdValue);
    await expect(adminPage).toHaveURL(new RegExp(`owner=${staffBIdValue}`));
    await expect(adminPage.getByText(/Hiển thị 1–1 trong 1$|Showing 1–1 of 1$/)).toBeVisible();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(theirs);
    await expect(adminPage.locator("#sheet-tab-live")).toContainText(/\b1$/); // the Sheets tab counts all of staff-b's live sheets (the search does not narrow it); afterEach leaves none behind

    await adminPage.goto(`/sheets/${uploaded.id}`);
    await expect(adminPage.getByText(new RegExp(`(Người tải lên|Uploaded by):? ${STAFF_NAME}`))).toBeVisible({ timeout: 30_000 });
  } finally {
    await context.close();
  }
});
