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
  await page.getByRole("button", { name: new RegExp(`tc48-${tag}`) }).click(); // the row's ⋯ menu
  await page.getByRole("menuitem", { name: /Đưa vào Thùng rác|Move to Trash/ }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await page.getByRole("tab", { name: /Thùng rác|Trash/ }).click();
  await page.locator("li", { hasText: `tc48-${tag}` }).getByRole("button", { name: /Khôi phục|Restore/ }).click();
  await expect(page.getByRole("status")).toContainText(/khôi phục|restored/i);
  const { data: audit, error } = await admin().from("audit_log").select("action").eq("target_id", id).in("action", ["sheet.trash", "sheet.restore"]).order("id");
  if (error) throw new Error(`audit log not read: ${error.message}`);
  expect(audit.map((a) => a.action)).toEqual(["sheet.trash", "sheet.restore"]);
});

test("TC-52 more than 1,000 sheets: all 1,120 are reachable by scrolling", async ({ page }) => {
  test.setTimeout(240_000); // 23 pages of 50, each a server round trip
  const prefix = `tc52-${randomUUID().slice(0, 8)}`;
  await seed(1120, prefix);
  await page.goto("/sheets");
  await page.getByRole("searchbox").fill(prefix);
  const rows = page.locator("li", { hasText: prefix });
  await expect(rows.first()).toBeVisible();
  const deadline = Date.now() + 180_000;
  while ((await rows.count()) < 1120 && Date.now() < deadline) {
    const before = await rows.count();
    await page.mouse.wheel(0, 20_000);
    const more = page.getByRole("button", { name: /Tải thêm|Load more/ });
    await more.click({ timeout: 1_000 }).catch(() => {}); // the scroll usually loads the page first and the button is gone
    // wait for the list to grow, then scroll again; a page that does not arrive within 5 s is retried until the deadline
    await expect.poll(() => rows.count(), { timeout: Math.min(5_000, Math.max(1_000, deadline - Date.now())) }).toBeGreaterThan(before).catch(() => {});
  }
  await expect(rows).toHaveCount(1120);
});

// Leave the account empty so the other specs see a short list and a slow page cannot spill over.
test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
});
