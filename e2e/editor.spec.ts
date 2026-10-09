import { expect, test } from "@playwright/test";
import { staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";
import { BOTTOM_RIGHT, TOP_LEFT, TOP_RIGHT, auditCount, editValue, marker, markers, openValuesSheet, storedSheet, waitForVersion } from "./support/sheets";

test.use({ viewport: { width: 1440, height: 900 } });

test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
});

function channelsNear(a: string, b: string, tolerance: number): boolean {
  const ch = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const x = ch(a);
  const y = ch(b);
  return x.every((v, i) => Math.abs(v - y[i]) <= tolerance);
}

test("TC-27 a vertical 2.50 becomes 2.60 in place, still vertical, in the same colour", async ({ page }) => {
  const { id } = await openValuesSheet(page, "tc27");
  await editValue(page, "2.50", TOP_LEFT, "2.6");
  await expect(marker(page, "2.50", TOP_LEFT)).toHaveAccessibleName(/(đã sửa thành|edited to) 2\.60/);
  await page.keyboard.press("Control+s");
  await waitForVersion(id, 3);
  const { edits, detections } = await storedSheet(id);
  expect(edits).toHaveLength(1);
  const detection = detections.find((d) => d.id === edits[0].detectionId);
  expect(detection).toBeDefined();
  expect(Math.abs(edits[0].box.cx - detection!.box.cx)).toBeLessThan(0.002); // in place
  expect(Math.abs(edits[0].box.cy - detection!.box.cy)).toBeLessThan(0.002);
  expect(edits[0]).toMatchObject({ oldValue: "2.50", newValue: "2.60", angle: -90, bgColor: "#ffffff" });
  expect(channelsNear(edits[0].textColor, "#676672", 40)).toBe(true);
  expect(edits[0].box.h).toBeGreaterThan(0);
  expect(edits[0].box.w).toBeGreaterThan(edits[0].box.h); // along the text, which runs up the page
});

test("TC-28 the old value the person confirmed is stored, not the machine reading", async ({ page }) => {
  const { id } = await openValuesSheet(page, "tc28");
  await editValue(page, "6.90", TOP_LEFT, "7.1", "6.80");
  await page.keyboard.press("Control+s");
  await waitForVersion(id, 3);
  expect((await storedSheet(id)).edits[0]).toMatchObject({ oldValue: "6.80", newValue: "7.10" });
});

test("TC-29 an invalid new value is refused with a message and nothing changes", async ({ page }) => {
  await openValuesSheet(page, "tc29");
  await marker(page, "6.90", TOP_LEFT).click();
  const popover = page.getByRole("dialog", { name: /Sửa kích thước|Edit dimension/ });
  await popover.getByLabel(/Số mới|New value/).fill("abc");
  await popover.getByLabel(/Số mới|New value/).press("Enter");
  await expect(popover).toContainText(/Chỉ nhập số|Numbers only/);
  await popover.getByLabel(/Số mới|New value/).press("Escape");
  await expect(popover).toBeHidden();
  await expect(marker(page, "6.90", TOP_LEFT)).toBeFocused();
  await expect(page.getByRole("button", { name: /(đã sửa thành|edited to) / })).toHaveCount(0);
  await expect(page.getByText(/● (Chưa lưu|Unsaved)/)).toHaveCount(0);
});

test("TC-33 locked zones do nothing when clicked", async ({ page }) => {
  await openValuesSheet(page, "tc33");
  const canvas = page.getByRole("img", { name: /^(Phiếu|Sheet) / });
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const spots = [[0.8, 0.55], [0.3, 0.86], [0.3, 0.05], [0.8, 0.3]] as const; // stone chart, bottom boxes, header, the right-hand table's 5.75
  const viewportH = page.viewportSize()!.height;
  expect(box.y + Math.max(...spots.map(([, fy]) => fy)) * box.height).toBeLessThan(viewportH);
  // Positive control: a real marker does open its popover.
  await marker(page, "6.90", TOP_LEFT).click();
  const popover = page.getByRole("dialog", { name: /Sửa kích thước|Edit dimension/ });
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  for (const [fx, fy] of spots) {
    await page.mouse.click(box.x + fx * box.width, box.y + fy * box.height);
    await page.waitForTimeout(500); // the assertion is that nothing happens
    expect(await page.getByRole("dialog").count()).toBe(0);
  }
  await expect(markers(page)).toHaveCount(11);
  await expect(page.getByText(/● (Chưa lưu|Unsaved)/)).toHaveCount(0);
});

test("TC-37 two saved edits are still there after a reload; version +1 and sheet.save logged", async ({ page }) => {
  const { id } = await openValuesSheet(page, "tc37");
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  await editValue(page, "1.70", BOTTOM_RIGHT, "1.75");
  await expect(page.getByText(/● (Chưa lưu|Unsaved)/)).toBeVisible();
  await page.keyboard.press("Control+s");
  await waitForVersion(id, 3);
  await expect(page.getByText(/Đã lưu lúc|Saved at/)).toBeVisible();
  await page.reload();
  await expect(markers(page)).toHaveCount(11, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /(đã sửa thành|edited to) / })).toHaveCount(2);
  expect(await auditCount(id, "sheet.save")).toBe(1);
});

test("TC-31 reverting an edit removes it from the saved sheet", async ({ page }) => {
  const { id } = await openValuesSheet(page, "tc31");
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  await marker(page, "6.90", TOP_LEFT).click();
  await page.getByRole("button", { name: /Trả về số gốc|Revert to original/ }).click();
  await expect(page.getByRole("button", { name: /(đã sửa thành|edited to) / })).toHaveCount(0);
  await expect(page.getByText(/● (Chưa lưu|Unsaved)/)).toHaveCount(0); // back to what is saved
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(1000); // the assertion is that nothing is stored
  const stored = await storedSheet(id);
  expect(stored.version).toBe(2);
  expect(stored.edits).toEqual([]);
});

test("TC-38 the second of two people to save sees who saved first; the first person's work stays", async ({ page, browser }) => {
  const { id } = await openValuesSheet(page, "tc38");
  const other = await browser.newContext({ storageState: "e2e/.auth/staff-b.json", viewport: { width: 1440, height: 900 } });
  try {
    const pageB = await other.newPage();
    await pageB.goto(`/sheets/${id}`);
    await expect(markers(pageB)).toHaveCount(11, { timeout: 30_000 });
    await editValue(page, "6.90", TOP_LEFT, "7.1");
    await page.keyboard.press("Control+s");
    await waitForVersion(id, 3);
    await editValue(pageB, "1.50", TOP_RIGHT, "1.6");
    await pageB.keyboard.press("Control+s");
    const conflict = pageB.getByRole("alertdialog");
    await expect(conflict).toContainText(/E2E Staff (đã lưu|saved)/);
    const stored = await storedSheet(id);
    expect(stored.version).toBe(3);
    expect(stored.edits.map((e) => e.oldValue)).toEqual(["6.90"]);
    await conflict.getByRole("button", { name: /Tải bản mới nhất|Load latest version/ }).click();
    await expect(conflict).toBeHidden();
    await expect(pageB.getByRole("button", { name: /(đã sửa thành|edited to) 7\.10/ })).toHaveCount(1);
    await expect(pageB.getByRole("button", { name: /(đã sửa thành|edited to) 1\.60/ })).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test("TC-39 leaving with unsaved changes asks first", async ({ page }) => {
  const { id } = await openValuesSheet(page, "tc39");
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  let message = "";
  page.once("dialog", (d) => {
    message = d.message();
    void d.dismiss();
  });
  await page.getByRole("link", { name: /^← (Phiếu|Sheets)$/ }).click();
  await expect.poll(() => message).toMatch(/chưa lưu|unsaved/i);
  await expect(page).toHaveURL(new RegExp(`/sheets/${id}$`));
  await expect(marker(page, "6.90", TOP_LEFT)).toHaveAccessibleName(/(đã sửa thành|edited to) 7\.10/);
});

test("TC-40 a save made offline keeps the changes and succeeds on Try again", async ({ page, context }) => {
  const { id } = await openValuesSheet(page, "tc40");
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  await context.setOffline(true);
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/kiểm tra kết nối|check your connection/)).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("button", { name: /^(Thử lại|Try again)$/ }).click();
  await waitForVersion(id, 3);
  expect((await storedSheet(id)).edits[0]).toMatchObject({ oldValue: "6.90", newValue: "7.10" });
});

test("TC-41 saving a sheet someone moved to the Trash says so", async ({ page, context }) => {
  const { id, name } = await openValuesSheet(page, "tc41");
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  const list = await context.newPage();
  await list.goto("/sheets");
  await list.getByRole("searchbox").fill(name);
  await list.getByRole("button", { name: new RegExp(name) }).click(); // the row's ⋯ menu
  await list.getByRole("menuitem", { name: /Đưa vào Thùng rác|Move to Trash/ }).click();
  await expect.poll(async () => (await storedSheet(id)).deleted).toBe(true);
  await list.close();
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/khôi phục rồi lưu lại|Restore it, then save again/)).toBeVisible();
  expect((await storedSheet(id)).edits).toEqual([]);
});
