import { expect, test, type Page } from "@playwright/test";
import { staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";
import { PDF_VALUES } from "./support/files";
import {
  TOP_LEFT, auditCount, canvasPoint, dragBox, drawValuesPng, editValue, marker, openSheetWithImageValue, openValuesSheet, storedSheet,
  uploadSheet, waitForVersion, watchOcrRequests,
} from "./support/sheets";

test.use({ viewport: { width: 1440, height: 900 } });

test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
});

const popover = (page: Page) => page.getByRole("dialog", { name: /Sửa kích thước|Edit dimension/ });
const drawButton = (page: Page) => page.getByRole("button", { name: /^(Vẽ khung|Draw box)/ });
const matchingPrompt = (page: Page) => page.getByRole("dialog", { name: /Số trùng|Same value elsewhere/ });

test("TC-24 a value missing from the text layer is read by clicking it, within 5 seconds", async ({ page }) => {
  test.setTimeout(240_000);
  const { id, target } = await openSheetWithImageValue(page, "tc24");
  // A sheet read from its text layer does not warm the reader up: the first click starts it.
  const point = await canvasPoint(page, target.cx, target.cy);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("section[data-reader-state='ready']")).toBeVisible({ timeout: 120_000 });
  const readyAt = Date.now();
  await expect(popover(page)).toBeVisible({ timeout: 5_000 });
  const elapsed = Date.now() - readyAt;
  test.info().annotations.push({ type: "tc24", description: `reader ready to popover: ${elapsed} ms` });
  await expect(popover(page).getByLabel(/Số cũ|Old value/)).toHaveValue("1.70");
  await popover(page).getByLabel(/Số mới|New value/).fill("1.75");
  await popover(page).getByLabel(/Số mới|New value/).press("Enter");
  await page.keyboard.press("Control+s");
  await waitForVersion(id, 3);
  const stored = await storedSheet(id);
  expect(stored.detections.find((d) => d.source === "click")).toMatchObject({ readValue: "1.70" });
  expect(stored.edits).toEqual([expect.objectContaining({ oldValue: "1.70", newValue: "1.75" })]);
});

test("TC-25 with the value reader blocked, Draw box still marks a value that can be edited and saved", async ({ page }) => {
  test.setTimeout(150_000);
  await page.context().route("**/models/**", (route) => route.abort());
  await page.goto("/sheets");
  const { id } = await uploadSheet(page, `tc25b-${Date.now()}.png`, "image/png", await drawValuesPng(page));
  await expect(page.getByRole("alert").filter({ hasText: /bộ đọc số|value reader/ })).toBeVisible({ timeout: 60_000 });
  await drawButton(page).click();
  const v = PDF_VALUES[0]; // 6.90, horizontal
  await dragBox(page, v.cx - 0.02, v.cy - 0.008, v.cx + 0.02, v.cy + 0.008);
  const angle = page.getByRole("dialog", { name: /Chiều của số|Direction of the value/ });
  await angle.getByRole("button", { name: /Tiếp tục|Continue/ }).click(); // Horizontal is chosen by default
  await expect(popover(page).getByLabel(/Số cũ|Old value/)).toHaveValue("");
  await popover(page).getByLabel(/Số cũ|Old value/).fill("6.90");
  await popover(page).getByLabel(/Số mới|New value/).fill("7.1");
  await popover(page).getByLabel(/Số mới|New value/).press("Enter");
  await page.keyboard.press("Control+s");
  await waitForVersion(id, 2);
  const stored = await storedSheet(id);
  expect(stored.detections).toEqual([expect.objectContaining({ source: "manual", readValue: null, angle: 0 })]);
  expect(stored.edits).toEqual([expect.objectContaining({ oldValue: "6.90", newValue: "7.10" })]);
});

test("TC-32 changing one 2.50 offers the other one, and both become 2.60", async ({ page }) => {
  const { id } = await openValuesSheet(page, "tc32");
  await editValue(page, "2.50", TOP_LEFT, "2.6");
  const prompt = matchingPrompt(page);
  await expect(prompt).toContainText(/2\.50/);
  await expect(prompt).toContainText(/\b1\b/);
  await prompt.getByRole("button", { name: /Sửa luôn|Apply there too/ }).click();
  await expect(page.getByRole("button", { name: /(đã sửa thành|edited to) 2\.60/ })).toHaveCount(2);
  await page.keyboard.press("Control+s");
  await waitForVersion(id, 3);
  const { edits } = await storedSheet(id);
  expect(edits.map((e) => [e.oldValue, e.newValue])).toEqual([["2.50", "2.60"], ["2.50", "2.60"]]);
});

test("the matching prompt closes when another value is edited", async ({ page }) => {
  const { id } = await openValuesSheet(page, "matchclose");
  await editValue(page, "2.50", TOP_LEFT, "2.6");
  await expect(matchingPrompt(page)).toBeVisible();
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  await expect(matchingPrompt(page)).toHaveCount(0);
  await page.keyboard.press("Control+s");
  await waitForVersion(id, 3);
  const { edits } = await storedSheet(id);
  expect(edits.map((e) => [e.oldValue, e.newValue]).sort()).toEqual([["2.50", "2.60"], ["6.90", "7.10"]]);
});

test("TC-34 a box running into the right-hand table is refused", async ({ page }) => {
  await openValuesSheet(page, "tc34");
  await drawButton(page).click();
  await dragBox(page, 0.6, 0.3, 0.75, 0.33);
  await expect(page.getByRole("alert").filter({ hasText: /bốn ô hình vẽ|four drawing panels/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Chiều của số|Direction of the value/ })).toHaveCount(0);
  await expect(popover(page)).toHaveCount(0);
});

test("TC-35 a box over blank paper says there is no text in it", async ({ page }) => {
  await openValuesSheet(page, "tc35");
  await drawButton(page).click();
  await dragBox(page, 0.3, 0.39, 0.34, 0.42);
  await page.getByRole("dialog", { name: /Chiều của số|Direction of the value/ }).getByRole("button", { name: /Tiếp tục|Continue/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: /không có chữ|no text in this box/ })).toBeVisible();
  await page.waitForTimeout(1000); // nothing should happen, so there is nothing to wait for
  await expect(popover(page)).toHaveCount(0);
});

test("the matching prompt keeps K and Escape to itself", async ({ page }) => {
  await openValuesSheet(page, "matchkeys");
  await editValue(page, "2.50", TOP_LEFT, "2.6");
  await expect(matchingPrompt(page)).toBeVisible();
  await page.keyboard.press("k");
  await expect(drawButton(page)).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(matchingPrompt(page)).toHaveCount(0);
  await expect(drawButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(marker(page, "2.50", TOP_LEFT)).toBeFocused();
});

test("K switches Draw box on and Escape switches it off", async ({ page }) => {
  await openValuesSheet(page, "keyk");
  await page.getByRole("region", { name: /Vùng xem phiếu|Sheet view/ }).focus();
  await page.keyboard.press("k");
  await expect(drawButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(drawButton(page)).toHaveAttribute("aria-pressed", "false");
});

test("F-06 a new name is kept on screen and stored with the next save", async ({ page }) => {
  const { id } = await openValuesSheet(page, "rename");
  const next = `renamed-${Date.now()}`;
  await page.getByRole("button", { name: /^(Đổi tên|Rename)$/ }).click();
  await page.getByLabel(/Tên phiếu|Sheet name/).fill(next);
  await page.getByLabel(/Tên phiếu|Sheet name/).press("Enter");
  await expect(page.getByRole("heading", { name: next })).toBeVisible();
  await expect(page.getByText(/● (Chưa lưu|Unsaved)/)).toBeVisible();
  await page.keyboard.press("Control+s");
  await waitForVersion(id, 3);
  expect((await storedSheet(id)).name).toBe(next);
  expect(await auditCount(id, "sheet.save")).toBe(1);
});

test("Escape cancels a rename", async ({ page }) => {
  const { name } = await openValuesSheet(page, "renameesc");
  await page.getByRole("button", { name: /^(Đổi tên|Rename)$/ }).click();
  await page.getByLabel(/Tên phiếu|Sheet name/).fill(`other-${Date.now()}`);
  await page.getByLabel(/Tên phiếu|Sheet name/).press("Escape");
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText(/● (Chưa lưu|Unsaved)/)).toHaveCount(0);
});

test("the same refusal twice is a new alert each time", async ({ page }) => {
  await openValuesSheet(page, "twice");
  await drawButton(page).click();
  const refusal = page.getByRole("alert").filter({ hasText: /bốn ô hình vẽ|four drawing panels/ });
  await dragBox(page, 0.6, 0.3, 0.75, 0.33);
  await expect(refusal).toBeVisible();
  const first = await refusal.elementHandle();
  const firstId = await refusal.getAttribute("data-notice-id");
  await dragBox(page, 0.6, 0.3, 0.75, 0.33);
  await expect.poll(() => refusal.getAttribute("data-notice-id")).not.toBe(firstId);
  expect(await first!.evaluate((el) => el.isConnected)).toBe(false); // the old alert element was replaced
  await expect(refusal).toHaveCount(1);
});

test("a press outside an open popover only closes it; the next click reads", async ({ page }) => {
  test.setTimeout(240_000);
  const { target } = await openSheetWithImageValue(page, "outside");
  const ocr = watchOcrRequests(page); // the reader is not started until something asks for it
  await marker(page, "6.90", TOP_LEFT).click();
  await expect(popover(page)).toBeVisible();
  const rows = await page.locator("[data-value-row]").count();
  const point = await canvasPoint(page, target.cx, target.cy); // a value the list does not hold
  await page.mouse.click(point.x, point.y);
  await expect(popover(page)).toHaveCount(0);
  await page.waitForTimeout(2500); // the assertion is that nothing starts
  expect(ocr).toEqual([]);
  await expect(popover(page)).toHaveCount(0);
  expect(await page.locator("[data-value-row]").count()).toBe(rows);
  await page.mouse.click(point.x, point.y); // the second click reads
  await expect.poll(() => ocr.length, { timeout: 30_000 }).toBeGreaterThan(0);
});
