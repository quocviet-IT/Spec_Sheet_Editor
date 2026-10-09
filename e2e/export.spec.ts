import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";
import { framedPng, readPdf, readPng } from "./support/files";
import {
  TOP_LEFT, auditCount, canvasHash, editValue, exportSheet, openExportCheck, openValuesSheet, storedSheet,
  uploadSheet, waitForVersion,
} from "./support/sheets";

test.use({ viewport: { width: 1440, height: 900 } });

test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
});

const checkDialog = (page: Page) => page.getByRole("dialog", { name: /Kiểm tra trước khi xuất|Check before exporting/ });

test("TC-42 a PDF from an edited PDF sheet is one 792 × 612 pt page with no text, made in under 5 s", async ({ page }) => {
  const { id, name } = await openValuesSheet(page, "tc42");
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  const file = await exportSheet(page, "pdf");
  console.log(`TC-42 export time: ${file.ms} ms`);
  expect(file.fileName).toBe(`${name}-edited.pdf`);
  const pdf = await readPdf(file.path);
  expect(pdf.pages).toBe(1);
  expect(Math.abs(pdf.width - 792)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(pdf.height - 612)).toBeLessThanOrEqual(0.5);
  expect(pdf.textItems).toBe(0);
  expect(file.ms).toBeLessThan(5000);
  await expect.poll(() => auditCount(id, "sheet.export_pdf")).toBe(1);
});

test("TC-43 a PDF from an image sheet is one 792 × 612 pt page with no text", async ({ page }) => {
  const { id } = await uploadSheet(page, `tc43-${Date.now()}.png`, "image/png", framedPng(1135, 877));
  await waitForVersion(id, 2, 120_000); // the first detection ran and stored nothing
  const file = await exportSheet(page, "pdf");
  const pdf = await readPdf(file.path);
  expect(pdf.pages).toBe(1);
  expect(Math.abs(pdf.width - 792)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(pdf.height - 612)).toBeLessThanOrEqual(0.5);
  expect(pdf.textItems).toBe(0);
  await expect.poll(() => auditCount(id, "sheet.export_pdf")).toBe(1);
});

test("TC-44 PNG sizes follow the sheet and the pixels equal the editor canvas", async ({ page }) => {
  test.setTimeout(180_000);
  const pdfSheet = await openValuesSheet(page, "tc44a");
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  const hash = await canvasHash(page);
  const file = await exportSheet(page, "png");
  const png = readPng(file.path);
  expect({ w: png.width, h: png.height }).toEqual({ w: 3300, h: 2550 });
  expect(createHash("sha256").update(png.data).digest("hex")).toBe(hash);
  await expect.poll(() => auditCount(pdfSheet.id, "sheet.export_png")).toBe(1);

  const image = await uploadSheet(page, `tc44b-${Date.now()}.png`, "image/png", framedPng(1135, 877));
  await waitForVersion(image.id, 2, 120_000);
  const small = readPng((await exportSheet(page, "png")).path);
  expect({ w: small.width, h: small.height }).toEqual({ w: 1135, h: 877 });
  await expect.poll(() => auditCount(image.id, "sheet.export_png")).toBe(1);
});

test("TC-45 the check lists the edits, suggests the other 2.50 and reminds about the table", async ({ page }) => {
  await openValuesSheet(page, "tc45");
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
  await expect(dialog.getByRole("button", { name: /Sửa luôn những chỗ đó|Apply there too/ })).toHaveCount(0);
  await expect(dialog.getByText(/2\.50 (vẫn còn ở|still appears)/)).toHaveCount(0);

  await dialog.getByRole("button", { name: /Quay lại sửa|Back to editing/ }).click();
  await expect(dialog).toBeHidden();
  expect(downloads).toBe(0);
  await expect(page.getByRole("button", { name: /(đã sửa thành|edited to) 2\.60/ })).toHaveCount(2);
});

test("exporting a sheet with no edits shows the notice and still exports", async ({ page }) => {
  const { id } = await openValuesSheet(page, "noedits");
  expect((await storedSheet(id)).edits).toHaveLength(0);
  await openExportCheck(page, "png");
  const dialog = checkDialog(page);
  await expect(dialog.getByText(/Chưa sửa số nào|No values have been edited/)).toBeVisible();
  const downloading = page.waitForEvent("download", { timeout: 60_000 });
  await dialog.getByRole("button", { name: /^(Xuất|Export) PNG$/ }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await expect.poll(() => auditCount(id, "sheet.export_png")).toBe(1);
});
