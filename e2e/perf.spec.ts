import { expect, test } from "@playwright/test";
import { staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";
import { canvasPoint, editValue, markers, openSheetWithImageValue, openValuesSheet, openExportCheck, pressExport, TOP_LEFT } from "./support/sheets";

// NFR-01 timings. Only the production build is representative, so these skip on the dev server
// (run them with `npm run e2e:prod -- e2e/perf.spec.ts`).
test.use({ viewport: { width: 1440, height: 900 } });
test.skip(() => test.info().config.metadata.production !== true, "timings are measured on the production build only");

test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
});

test("NFR-01 a sheet with a text layer opens with its 11 values in 3 s, three times", async ({ page }) => {
  test.setTimeout(180_000);
  const { id } = await openValuesSheet(page, "perf-open");
  for (let i = 1; i <= 3; i++) {
    const started = Date.now();
    await page.goto(`/sheets/${id}`);
    await expect(markers(page)).toHaveCount(11, { timeout: 15_000 });
    const ms = Date.now() - started;
    console.log(`[timing] reopen-${i} ${ms} ms`);
    expect(ms).toBeLessThanOrEqual(3000);
  }
});

test("NFR-01 reading a value by clicking it takes 5 s at most once the reader is ready", async ({ page }) => {
  test.setTimeout(240_000);
  const { target } = await openSheetWithImageValue(page, "perf-read");
  const point = await canvasPoint(page, target.cx, target.cy);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("section[data-reader-state='ready']")).toBeVisible({ timeout: 120_000 });
  const readyAt = Date.now();
  await expect(page.getByRole("dialog", { name: /Sửa kích thước|Edit dimension/ })).toBeVisible({ timeout: 5_000 });
  const ms = Date.now() - readyAt;
  console.log(`[timing] read-on-click ${ms} ms`);
  expect(ms).toBeLessThanOrEqual(5000);
});

test("NFR-01 a PDF export of an edited sheet takes 5 s at most", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await openValuesSheet(page, "perf-export");
  await editValue(page, "6.90", TOP_LEFT, "7.1");
  await openExportCheck(page, "pdf");
  const { ms } = await pressExport(page, "pdf", testInfo);
  console.log(`[timing] export-pdf ${ms} ms`);
  expect(ms).toBeLessThanOrEqual(5000);
});
