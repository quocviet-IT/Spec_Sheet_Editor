import { expect, test, type Page } from "@playwright/test";

const ADMIN_STATE = "e2e/.auth/admin.json";
const STAFF_STATE = "e2e/.auth/staff.json";
const ADMIN_SECTION = /^(Dành cho quản trị viên|For Admins)$/;

async function open(page: Page, locale: "vi" | "en"): Promise<void> {
  await page.context().addCookies([{ name: "locale", value: locale, url: "http://localhost:3000" }]);
  await page.goto("/guide");
}

/** Every <img> in the guide has loaded and has a real alt text (scrolled into view first: images are lazy). */
async function expectImagesLoaded(page: Page): Promise<number> {
  const images = page.locator("main img");
  const count = await images.count();
  for (let i = 0; i < count; i++) {
    const image = images.nth(i);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth), { message: `image ${i} should load` }).toBeGreaterThan(0);
    await expect(image).toHaveAttribute("alt", /\S/);
  }
  return count;
}

test.describe("as a Staff account", () => {
  test.use({ storageState: STAFF_STATE, viewport: { width: 1440, height: 900 } });

  for (const locale of ["vi", "en"] as const) {
    test(`the guide loads in ${locale}, every image loads and there is no Admin section`, async ({ page }) => {
      await open(page, locale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^(Hướng dẫn sử dụng|User guide)$/);
      await expect(page.getByRole("navigation", { name: /^(Mục lục|Contents)$/ })).toBeVisible();
      expect(await expectImagesLoaded(page)).toBe(7); // the nine shots, minus the two Admin ones
      await expect(page.getByRole("heading", { level: 2, name: ADMIN_SECTION })).toHaveCount(0);
      await expect(page.locator("#admin")).toHaveCount(0);
    });
  }

  test("the header link leads to the guide", async ({ page }) => {
    await page.goto("/sheets");
    await page.getByRole("navigation").getByRole("link", { name: /^(Hướng dẫn|Guide)$/ }).click();
    await page.waitForURL("**/guide");
  });

  test("a table-of-contents link scrolls to its section", async ({ page }) => {
    await open(page, "en");
    await page.getByRole("navigation", { name: "Contents" }).getByRole("link", { name: "Keyboard shortcuts" }).click();
    await expect(page).toHaveURL(/#shortcuts$/);
    await expect(page.locator("#shortcuts")).toBeInViewport();
  });
});

test.describe("as an Admin", () => {
  test.use({ storageState: ADMIN_STATE, viewport: { width: 1440, height: 900 } });

  test("the guide has the Admin section and all nine images load", async ({ page }) => {
    await open(page, "en");
    await expect(page.getByRole("heading", { level: 2, name: ADMIN_SECTION })).toBeVisible();
    expect(await expectImagesLoaded(page)).toBe(9);
  });
});
