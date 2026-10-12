import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { staffId } from "./support/account";
import { admin, deleteSheetsOf } from "./support/db";

async function seed(count: number, prefix: string): Promise<string[]> {
  const owner = await staffId();
  const rows = Array.from({ length: count }, (_, i) => {
    const id = randomUUID();
    return {
      id, name: `${prefix} ${String(i).padStart(4, "0")}`, source_type: "png", source_path: `${id}/source.png`,
      thumb_path: `${id}/thumb.jpg`, page_px_w: 1135, page_px_h: 877, created_by: owner, updated_by: owner,
    };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin().from("spec_sheets").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`test sheets not inserted: ${error.message}`);
  }
  return rows.map((r) => r.id);
}

test("TC-48 Staff trash a sheet and restore it; two audit entries", async ({ page }) => {
  const tag = randomUUID().slice(0, 8);
  const [id] = await seed(1, `tc48-${tag}`);
  await page.goto("/sheets");
  await page.getByRole("searchbox").fill(`tc48-${tag}`);
  await expect(page).toHaveURL(/[?&]q=/); // the address takes the search 300 ms after typing
  await page.getByRole("button", { name: new RegExp(`tc48-${tag}`) }).click(); // the row's ⋯ menu
  await page.getByRole("menuitem", { name: /Đưa vào Thùng rác|Move to Trash/ }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: /Thùng rác|Trash/ }).click();
  await page.locator("li", { hasText: `tc48-${tag}` }).getByRole("button", { name: /Khôi phục|Restore/ }).click();
  await expect(page.getByRole("status")).toContainText(/khôi phục|restored/i);
  const { data: audit, error } = await admin().from("audit_log").select("action").eq("target_id", id).in("action", ["sheet.trash", "sheet.restore"]).order("id");
  if (error) throw new Error(`audit log not read: ${error.message}`);
  expect(audit.map((a) => a.action)).toEqual(["sheet.trash", "sheet.restore"]);
});

test("TC-52 more than 1,000 sheets: all 1,120 are reachable page by page", async ({ page }) => {
  test.setTimeout(240_000); // 23 pages of 50, each a server round trip
  const prefix = `tc52-${randomUUID().slice(0, 8)}`;
  await seed(1120, prefix);
  await page.goto("/sheets");
  await page.getByRole("searchbox").fill(prefix);
  await expect(page).toHaveURL(/[?&]q=/); // the address takes the search 300 ms after typing
  const rows = page.locator("li", { hasText: prefix });
  await expect(rows.first()).toBeVisible();
  await expect(page.getByText(/Hiển thị 1–25 trong 1\.?120|Showing 1–25 of 1,?120/)).toBeVisible(); // the default size is 25

  await page.getByLabel(/Số dòng mỗi trang|Rows per page/).selectOption("50");
  await expect(page).toHaveURL(/size=50/);
  await expect(page.getByText(/Hiển thị 1–50 trong 1\.?120|Showing 1–50 of 1,?120/)).toBeVisible();

  const next = page.getByRole("link", { name: /Trang sau|Next page/ });
  for (let n = 1; n < 23; n++) {
    await expect(rows).toHaveCount(50); // pages 1 to 22 are full
    await next.click();
    await expect(page).toHaveURL(new RegExp(`page=${n + 1}(&|$)`));
    // wait for the new page itself, so the next click never uses the old page's link
    const from = n * 50 + 1;
    await expect(page.getByText(new RegExp(`(Hiển thị|Showing) ${from}–`))).toBeVisible();
  }
  await expect(page.getByText(/Hiển thị 1101–1120 trong 1\.?120|Showing 1101–1120 of 1,?120/)).toBeVisible();
  await expect(rows).toHaveCount(20); // the last page holds the rest
  await expect(page.getByRole("link", { name: /Trang sau|Next page/ })).toHaveCount(0); // the end is a disabled button, not a link
  await expect(page.getByRole("button", { name: /Trang sau|Next page/ })).toBeDisabled();
});

// Leave the account empty so the other specs see a short list and a slow page cannot spill over.
test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
});
