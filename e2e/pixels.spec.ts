import { expect, test } from "@playwright/test";
import { staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";
import { DIMENSION_LINE_PX } from "./support/files";
import {
  TOP_LEFT, canvasChanges, dragBox, drawValuesPng, editValue, marker, maskPolygon, openValuesSheet, polygonTouchesRect,
  rememberCanvas, rememberedDarkPixels, storedSheet, uploadSheet, waitForVersion,
} from "./support/sheets";

test.use({ viewport: { width: 1440, height: 900 } });

test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
});

const rectPolygon = (r: { x: number; y: number; w: number; h: number }) => [
  { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
];

test("TC-30 editing 16.30 changes only pixels inside its mask, and the dimension line under it stays", async ({ page }) => {
  const { id } = await openValuesSheet(page, "tc30");
  const size = await rememberCanvas(page);
  // The line is really on the page, so "it stays" below means something.
  expect(await rememberedDarkPixels(page, DIMENSION_LINE_PX)).toBeGreaterThan(50);
  await editValue(page, "16.30", TOP_LEFT, "16.35");
  await expect.poll(async () => (await canvasChanges(page)).changed).toBeGreaterThan(0); // the repaint
  await page.keyboard.press("Control+s");
  await waitForVersion(id, 3);
  const [edit] = (await storedSheet(id)).edits;
  expect(polygonTouchesRect(maskPolygon(edit, size.width, size.height), DIMENSION_LINE_PX)).toBe(false);
  const inMask = await canvasChanges(page, maskPolygon(edit, size.width, size.height));
  expect(inMask.changed).toBeGreaterThan(0);
  expect(inMask.outside).toBe(0);
  const onLine = await canvasChanges(page, rectPolygon(DIMENSION_LINE_PX));
  expect(onLine.inside).toBe(0);
});

test("TC-31 reverting an edit restores the original pixel for pixel", async ({ page }) => {
  await openValuesSheet(page, "tc31px");
  await rememberCanvas(page);
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  await expect.poll(async () => (await canvasChanges(page)).changed).toBeGreaterThan(0);
  await marker(page, "6.90", TOP_LEFT).click();
  await page.getByRole("button", { name: /Trả về số gốc|Revert to original/ }).click();
  await expect.poll(async () => (await canvasChanges(page)).changed).toBe(0);
});

test("TC-36 a diagonal value marked by hand at 58 degrees is redrawn at 58 degrees", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/sheets");
  const png = await drawValuesPng(page, [
    { value: "6.90", cx: 0.12, cy: 0.2, angle: 0 },
    { value: "1.20", cx: 0.3, cy: 0.5, angle: 58 },
  ]);
  const { id } = await uploadSheet(page, `tc36-${Date.now()}.png`, "image/png", png);
  await waitForVersion(id, 2, 180_000); // the first OCR scan is stored
  await rememberCanvas(page);
  await page.getByRole("button", { name: /^(Vẽ khung|Draw box)/ }).click();
  // The turned text is about 70 × 85 px; a 120 × 120 px box around its centre holds it.
  await dragBox(page, 0.3 - 60 / 3300, 0.5 - 60 / 2550, 0.3 + 60 / 3300, 0.5 + 60 / 2550);
  const angle = page.getByRole("dialog", { name: /Chiều của số|Direction of the value/ });
  await angle.getByLabel(/Xoay tự do|Free rotation/).check();
  await angle.getByLabel(/Góc \(độ\)|Angle \(degrees\)/).fill("58");
  await angle.getByRole("button", { name: /Tiếp tục|Continue/ }).click();
  const popover = page.getByRole("dialog", { name: /Sửa kích thước|Edit dimension/ });
  await popover.getByLabel(/Số cũ|Old value/).fill("1.20");
  await popover.getByLabel(/Số mới|New value/).fill("1.25");
  await popover.getByLabel(/Số mới|New value/).press("Enter");
  await expect.poll(async () => (await canvasChanges(page)).changed).toBeGreaterThan(0); // the repaint
  const changes = await canvasChanges(page);
  expect(changes.angle).not.toBeNull();
  expect(Math.abs((changes.angle ?? 0) - 58)).toBeLessThanOrEqual(4);
  await page.keyboard.press("Control+s");
  await waitForVersion(id, 3);
  expect((await storedSheet(id)).edits).toEqual([expect.objectContaining({ oldValue: "1.20", newValue: "1.25", angle: 58 })]);
});
