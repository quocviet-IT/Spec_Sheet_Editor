import { expect, type Page } from "@playwright/test";

/** Opens the account menu in the header and waits for it to show. */
export async function openAccountMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^(Tài khoản|Account): / }).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

/** Signs out the way a person does now: through the account menu. */
export async function signOutFromMenu(page: Page): Promise<void> {
  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: /^(Đăng xuất|Sign out)$/ }).click();
}
