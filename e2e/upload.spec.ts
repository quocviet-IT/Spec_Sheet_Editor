import { expect, test, type Page } from "@playwright/test";
import { templatePdf, framedPng, marginedPng } from "./support/files";
import { admin, deleteSheetsOf } from "./support/db";
import { staffId } from "./support/account";

async function openUpload(page: Page) {
  await page.goto("/sheets");
  await page.getByRole("button", { name: /Tải phiếu lên|Upload sheet/ }).first().click();
  return page.getByRole("dialog");
}

async function choose(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.locator("#upload-file").setInputFiles({ name, mimeType, buffer });
}

async function rowsNamed(name: string) {
  const { data, error } = await admin().from("spec_sheets").select("id, page_px_w, page_px_h").eq("name", name).eq("created_by", await staffId());
  if (error) throw new Error(`sheets not read: ${error.message}`);
  return data;
}

test("TC-08 a matching PDF becomes a 3300 × 2550 sheet and sheet.upload is logged", async ({ page }) => {
  const dialog = await openUpload(page);
  await choose(page, "tc08-sheet.pdf", "application/pdf", await templatePdf());
  await dialog.getByRole("button", { name: /^(Tải lên|Upload)$/ }).click();
  await page.waitForURL(/\/sheets\/[0-9a-f-]{36}$/);
  const [row] = await rowsNamed("tc08-sheet");
  expect(row).toMatchObject({ page_px_w: 3300, page_px_h: 2550 });
  const { count, error } = await admin().from("audit_log").select("id", { count: "exact", head: true }).eq("action", "sheet.upload").eq("target_id", row.id);
  if (error) throw new Error(`audit log not read: ${error.message}`);
  expect(count).toBe(1);
});

test("TC-09 a 1135 × 877 PNG is accepted with a low-resolution warning", async ({ page }) => {
  const dialog = await openUpload(page);
  await choose(page, "tc09-lowres.png", "image/png", framedPng(1135, 877));
  await expect(dialog.getByText(/1135 px/)).toBeVisible();
  await dialog.getByRole("button", { name: /^(Tải lên|Upload)$/ }).click();
  await page.waitForURL(/\/sheets\/[0-9a-f-]{36}$/);
  expect((await rowsNamed("tc09-lowres")).length).toBe(1);
});

test("a sheet with its own white margins is accepted and keeps the whole image as its page", async ({ page }) => {
  const dialog = await openUpload(page);
  await choose(page, "margined-sheet.png", "image/png", marginedPng(1135, 877));
  await dialog.getByRole("button", { name: /^(Tải lên|Upload)$/ }).click();
  await page.waitForURL(/\/sheets\/[0-9a-f-]{36}$/);
  const [row] = await rowsNamed("margined-sheet");
  // The page is rebuilt from the sheet's content and the template margins, so it is within a pixel or two of the image.
  expect(Math.abs(row.page_px_w - 1135)).toBeLessThanOrEqual(2);
  expect(Math.abs(row.page_px_h - 877)).toBeLessThanOrEqual(2);
});

test("TC-12 a drawing-only crop is refused", async ({ page }) => {
  const dialog = await openUpload(page);
  await choose(page, "tc12-crop.png", "image/png", framedPng(584, 434));
  await expect(dialog.getByRole("alert")).toContainText(/mẫu phiếu|sheet template/);
});

test("TC-15 other file types are refused", async ({ page }) => {
  const dialog = await openUpload(page);
  await choose(page, "notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from("x"));
  await expect(dialog.getByRole("alert")).toContainText(/PDF, PNG/);
  await choose(page, "photo.heic", "image/heic", Buffer.from("x"));
  await expect(dialog.getByRole("alert")).toContainText(/PDF, PNG/);
});

test("TC-16 a 21 MB file is refused with its size and the limit", async ({ page }) => {
  const dialog = await openUpload(page);
  await choose(page, "big.pdf", "application/pdf", Buffer.alloc(21 * 1024 * 1024, 0x20));
  await expect(dialog.getByRole("alert")).toContainText(/21\s*MB/);
  await expect(dialog.getByRole("alert")).toContainText(/20\s*MB/);
});

test("TC-18 a 3-page PDF uses page 1 and says so", async ({ page }) => {
  const dialog = await openUpload(page);
  await choose(page, "tc18-three.pdf", "application/pdf", await templatePdf(3));
  await expect(dialog.getByText(/3 (trang|pages)/)).toBeVisible();
});

test("TC-19 an upload cut off by the network leaves no half-finished sheet, and a retry completes it", async ({ page }) => {
  const dialog = await openUpload(page);
  await choose(page, "tc19-offline.pdf", "application/pdf", await templatePdf());
  await expect(dialog.getByRole("button", { name: /^(Tải lên|Upload)$/ })).toBeVisible();
  await page.route("**/storage/v1/object/**", (route) => route.abort());
  await dialog.getByRole("button", { name: /^(Tải lên|Upload)$/ }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect((await rowsNamed("tc19-offline")).length).toBe(0);
  await page.unroute("**/storage/v1/object/**");
  await dialog.getByRole("button", { name: /Thử lại|Try again/ }).click();
  await page.waitForURL(/\/sheets\/[0-9a-f-]{36}$/);
  expect((await rowsNamed("tc19-offline")).length).toBe(1);
});

// Leave the account empty so the other specs start clean.
test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
});
