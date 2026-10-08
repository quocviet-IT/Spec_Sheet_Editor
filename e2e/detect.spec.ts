import { expect, test } from "@playwright/test";
import { staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";
import { PDF_VALUES, valuesPdf } from "./support/files";
import { auditCount, drawValuesPng, markers, storedSheet, unmatchedValues, uploadSheet, waitForVersion, watchOcrRequests } from "./support/sheets";

test.use({ viewport: { width: 1440, height: 900 } });

test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
});

test("TC-21 / TC-23 a PDF text layer gives all 11 values with their angles, nothing outside the drawing, no OCR", async ({ page }) => {
  const ocr = watchOcrRequests(page);
  const { id } = await uploadSheet(page, `tc21-${Date.now()}.pdf`, "application/pdf", await valuesPdf());
  await expect(markers(page)).toHaveCount(11, { timeout: 30_000 });
  await waitForVersion(id, 2);
  const { detections } = await storedSheet(id);
  expect(detections).toHaveLength(11);
  expect(detections.every((d) => d.source === "pdf-text" && d.confidence === null)).toBe(true);
  expect(unmatchedValues(PDF_VALUES, detections, { position: 0.006, angle: 1 })).toEqual([]);
  expect(detections.map((d) => d.readValue)).not.toContain("5.75");
  expect(detections.map((d) => d.readValue)).not.toContain("3.39");
  expect(await auditCount(id, "sheet.detect")).toBe(1);
  expect(ocr).toEqual([]);
});

test("TC-26 reopening a sheet shows its stored markers within 3 seconds and detects nothing again", async ({ page }) => {
  const { id } = await uploadSheet(page, `tc26-${Date.now()}.pdf`, "application/pdf", await valuesPdf());
  await expect(markers(page)).toHaveCount(11, { timeout: 30_000 });
  await waitForVersion(id, 2);
  const ocr = watchOcrRequests(page);
  // One warm-up reload, so the development server has compiled the route and cached the files; the
  // timed reload then measures the editor: fetch, render, trim and markers from the stored values.
  // NFR-01 itself (3 s on an office PC) is checked again on a production build before release (M7).
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(markers(page)).toHaveCount(11, { timeout: 15_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(markers(page)).toHaveCount(11, { timeout: 3_000 });
  expect(ocr).toEqual([]);
  expect((await storedSheet(id)).version).toBe(2);
});

test("an image sheet is read with OCR: values inside the drawing only, sheet.detect logged, no second scan on reopen", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/sheets");
  const png = await drawValuesPng(page);
  const { id } = await uploadSheet(page, `ocr-${Date.now()}.png`, "image/png", png);
  const scanStart = Date.now();
  await waitForVersion(id, 2, 180_000);
  const scanMs = Date.now() - scanStart;
  const { detections } = await storedSheet(id);
  const missed = unmatchedValues(PDF_VALUES, detections, { position: 0.01, angle: 1 });
  console.log(`OCR figures: ${detections.length} stored values, ${PDF_VALUES.length - missed.length} of ${PDF_VALUES.length} expected found, scan ${(scanMs / 1000).toFixed(1)} s from upload page`);
  expect(detections.every((d) => d.source === "ocr" && typeof d.confidence === "number")).toBe(true);
  expect(detections.map((d) => d.readValue)).not.toContain("5.75");
  expect(detections.map((d) => d.readValue)).not.toContain("3.39");
  expect(PDF_VALUES.length - missed.length).toBeGreaterThanOrEqual(9); // the TC-20 bar
  expect(await auditCount(id, "sheet.detect")).toBe(1);
  const ocr = watchOcrRequests(page);
  await page.reload();
  await expect(markers(page)).toHaveCount(detections.length, { timeout: 15_000 });
  expect(ocr).toEqual([]);
});

test("TC-25 when the value reader cannot be downloaded the editor says so and nothing is stored", async ({ page }) => {
  test.setTimeout(120_000);
  await page.context().route("**/models/**", (route) => route.abort());
  await page.goto("/sheets");
  const png = await drawValuesPng(page);
  const { id } = await uploadSheet(page, `tc25-${Date.now()}.png`, "image/png", png);
  await expect(page.getByRole("alert").filter({ hasText: /bộ đọc số|value reader/ })).toBeVisible({ timeout: 60_000 });
  expect((await storedSheet(id)).version).toBe(1);
  expect(await auditCount(id, "sheet.detect")).toBe(0);
});
