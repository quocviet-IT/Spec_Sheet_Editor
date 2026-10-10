import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";
import { framedPng, marginedValuesPdf, PDF_VALUES, readPdf, readPng, valuesPdf } from "./support/files";
import {
  BOTTOM_LEFT, TOP_LEFT, TOP_RIGHT, auditCount, canvasHash, editValue, exportSheet, openExportCheck, openValuesSheet, pressExport,
  marker, markers, storedSheet, uploadSheet, waitForVersion,
} from "./support/sheets";

test.use({ viewport: { width: 1440, height: 900 } });

test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
});

const checkDialog = (page: Page) => page.getByRole("dialog", { name: /Kiểm tra trước khi xuất|Check before exporting/ });

test("TC-42 a PDF from an edited PDF sheet is one 792 × 612 pt page with no text, made in under 5 s, and shows the edit", async ({ page }, testInfo) => {
  test.setTimeout(300_000); // the exported PDF is read again by OCR at the end
  const { id, name } = await openValuesSheet(page, "tc42");
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  const file = await exportSheet(page, "pdf", testInfo);
  console.log(`TC-42 export time: ${file.ms} ms`);
  expect(file.fileName).toBe(`${name}-edited.pdf`);
  const pdf = await readPdf(file.path);
  expect(pdf.pages).toBe(1);
  expect(Math.abs(pdf.width - 792)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(pdf.height - 612)).toBeLessThanOrEqual(0.5);
  expect(pdf.textItems).toBe(0);
  expect(file.ms).toBeLessThan(5000);
  await expect.poll(() => auditCount(id, "sheet.export_pdf")).toBe(1);

  // BR-06 end to end: the PDF has no text layer, so uploading it makes the first detection read it with OCR;
  // what OCR reads at the place of 6.90 is the new value.
  const place = PDF_VALUES.find((v) => v.value === "6.90")!;
  const again = await uploadSheet(page, `tc42-again-${Date.now()}.pdf`, "application/pdf", readFileSync(file.path));
  await waitForVersion(again.id, 2, 240_000);
  const near = (await storedSheet(again.id)).detections.filter(
    (d) => Math.abs(d.box.cx - place.cx) <= 0.01 && Math.abs(d.box.cy - place.cy) <= 0.01,
  );
  const read = near.map((d) => d.readValue);
  console.log(`TC-42 OCR read at the place of 6.90: ${JSON.stringify(read)}`);
  expect(read).toContain("7.10");
  expect(read).not.toContain("6.90");
});

test("TC-43 a PDF from an image sheet is one 792 × 612 pt page with no text", async ({ page }, testInfo) => {
  test.setTimeout(180_000); // the version wait below is 120 s
  const { id } = await uploadSheet(page, `tc43-${Date.now()}.png`, "image/png", framedPng(1135, 877));
  await waitForVersion(id, 2, 120_000); // the first detection ran and stored nothing
  const file = await exportSheet(page, "pdf", testInfo);
  const pdf = await readPdf(file.path);
  expect(pdf.pages).toBe(1);
  expect(Math.abs(pdf.width - 792)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(pdf.height - 612)).toBeLessThanOrEqual(0.5);
  expect(pdf.textItems).toBe(0);
  await expect.poll(() => auditCount(id, "sheet.export_pdf")).toBe(1);
});

test("a PDF exported from a sheet on an A4 portrait page keeps the A4 portrait page size", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await uploadSheet(page, `a4-export-${Date.now()}.pdf`, "application/pdf", await marginedValuesPdf({ onA4Portrait: true }));
  await expect(markers(page)).toHaveCount(11, { timeout: 30_000 });
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  const file = await exportSheet(page, "pdf", testInfo);
  const pdf = await readPdf(file.path);
  expect(pdf.pages).toBe(1);
  expect(Math.abs(pdf.width - 595)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(pdf.height - 842)).toBeLessThanOrEqual(0.5);
});

test("TC-44 PNG sizes follow the sheet and the pixels equal the edited editor canvas", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const pdfSheet = await openValuesSheet(page, "tc44a");
  const before = await canvasHash(page);
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  await expect(page.getByRole("button", { name: /(đã sửa thành|edited to) 7\.10/ })).toBeVisible();
  const after = await canvasHash(page);
  expect(after).not.toBe(before); // the edit is on the canvas
  const file = await exportSheet(page, "png", testInfo);
  const png = readPng(file.path);
  expect({ w: png.width, h: png.height }).toEqual({ w: 3300, h: 2550 });
  expect(createHash("sha256").update(png.data).digest("hex")).toBe(after); // and the file is that canvas
  await expect.poll(() => auditCount(pdfSheet.id, "sheet.export_png")).toBe(1);

  const image = await uploadSheet(page, `tc44b-${Date.now()}.png`, "image/png", framedPng(1135, 877));
  await waitForVersion(image.id, 2, 120_000);
  const small = readPng((await exportSheet(page, "png", testInfo)).path);
  expect({ w: small.width, h: small.height }).toEqual({ w: 1135, h: 877 });
  await expect.poll(() => auditCount(image.id, "sheet.export_png")).toBe(1);
});

test("TC-45 the check lists the edits, suggests the other 2.50 and reminds about the table, and Back exports nothing", async ({ page }) => {
  const { id } = await openValuesSheet(page, "tc45");
  await editValue(page, "2.50", TOP_LEFT, "2.6");
  const prompt = page.getByRole("dialog", { name: /Số trùng|Same value elsewhere/ });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: /^(Không|No)$/ }).click();
  await expect(prompt).toBeHidden();

  let downloads = 0;
  page.on("download", () => downloads++);
  await openExportCheck(page, "pdf");
  const dialog = checkDialog(page);
  await expect(dialog.getByRole("listitem")).toHaveCount(1);
  await expect(dialog.getByRole("listitem")).toContainText(/2\.50 → 2\.60 · (ô trên bên trái|top-left panel)/);
  await expect(dialog.getByText(/2\.50 (vẫn còn ở|still appears)/)).toBeVisible();
  await expect(dialog.getByText(/Bảng bên phải không đổi|table on the right does not change/)).toBeVisible();
  await dialog.getByRole("button", { name: /Sửa luôn những chỗ đó|Apply there too/ }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(2);
  await expect(dialog.getByRole("listitem").nth(1)).toContainText(new RegExp(`2\\.50 → 2\\.60 · (${BOTTOM_LEFT.source})`));
  await expect(dialog.getByRole("button", { name: /Sửa luôn những chỗ đó|Apply there too/ })).toHaveCount(0);
  await expect(dialog.getByText(/2\.50 (vẫn còn ở|still appears)/)).toHaveCount(0);

  await dialog.getByRole("button", { name: /Quay lại sửa|Back to editing/ }).click();
  await expect(dialog).toBeHidden();
  expect(await auditCount(id, "sheet.export_pdf")).toBe(0);
  await expect(page.getByRole("button", { name: /(đã sửa thành|edited to) 2\.60/ })).toHaveCount(2); // the page is back and settled
  expect(downloads).toBe(0);
});

test("exporting a sheet with no edits shows the notice and still exports", async ({ page }, testInfo) => {
  const { id } = await openValuesSheet(page, "noedits");
  expect((await storedSheet(id)).edits).toHaveLength(0);
  await openExportCheck(page, "png");
  const dialog = checkDialog(page);
  await expect(dialog.getByText(/Chưa sửa số nào|No values have been edited/)).toBeVisible();
  const file = await pressExport(page, "png", testInfo);
  expect(file.fileName).toMatch(/\.png$/);
  const png = readPng(file.path);
  expect({ w: png.width, h: png.height }).toEqual({ w: 3300, h: 2550 });
  await expect(dialog).toBeHidden();
  await expect.poll(() => auditCount(id, "sheet.export_png")).toBe(1);
});

test("Apply there too in the export check leaves a value that was edited to something else alone", async ({ page }) => {
  // Three 2.50: top-left, bottom-left and (added here) top-right.
  await page.goto("/sheets");
  const { id } = await uploadSheet(page, `applyskip-${Date.now()}.pdf`, "application/pdf", await valuesPdf({ extra: [{ value: "2.50", cx: 0.5, cy: 0.4, angle: 0 }] }));
  await expect(markers(page)).toHaveCount(12, { timeout: 30_000 });
  await waitForVersion(id, 2);
  const noPrompt = async () => page.getByRole("dialog", { name: /Số trùng|Same value elsewhere/ }).getByRole("button", { name: /^(Không|No)$/ }).click();
  await editValue(page, "2.50", TOP_LEFT, "2.6");
  await noPrompt();
  await editValue(page, "2.50", BOTTOM_LEFT, "2.8"); // edited to something else first
  await noPrompt();
  await openExportCheck(page, "pdf");
  const dialog = checkDialog(page);
  await expect(dialog.getByRole("listitem")).toHaveCount(2);
  await dialog.getByRole("button", { name: /Sửa luôn những chỗ đó|Apply there too/ }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: /Sửa luôn những chỗ đó|Apply there too/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: /Quay lại sửa|Back to editing/ }).click();
  await expect(marker(page, "2.50", TOP_LEFT)).toHaveAccessibleName(/(đã sửa thành|edited to) 2\.60/);
  await expect(marker(page, "2.50", BOTTOM_LEFT)).toHaveAccessibleName(/(đã sửa thành|edited to) 2\.80/); // untouched
  await expect(marker(page, "2.50", TOP_RIGHT)).toHaveAccessibleName(/(đã sửa thành|edited to) 2\.60/); // the one left over
});

test("Shift+Tab from the first control of the check dialog goes to the last one, and Tab from the last to the first", async ({ page }) => {
  await openValuesSheet(page, "dialogtab");
  await openExportCheck(page, "png");
  const dialog = checkDialog(page);
  const back = dialog.getByRole("button", { name: /Quay lại sửa|Back to editing/ });
  const start = dialog.getByRole("button", { name: /^(Xuất|Export) PNG$/ });
  await back.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(start).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(back).toBeFocused();
});
