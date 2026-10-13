import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });

const LIGHT = "rgb(245, 247, 245)";
const DARK = "rgb(15, 20, 18)";

const background = (page: Page): Promise<string> => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** Opens the theme menu and chooses one of its items; waits until the page carries the choice. */
async function choose(page: Page, item: RegExp, theme: "light" | "dark" | "system"): Promise<void> {
  await page.getByRole("button", { name: /^(Giao diện|Theme): / }).click();
  await page.getByRole("menuitemradio", { name: item }).click();
  await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme);
}

test("the theme is chosen, kept after a reload, and System follows the device", async ({ page }) => {
  await page.goto("/sheets");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  try {
    await choose(page, /^(Tối|Dark)/, "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await background(page)).toBe(DARK);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await background(page)).toBe(DARK);

    await choose(page, /^(Theo máy|System)/, "system");
    expect(await background(page)).toBe(LIGHT);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => background(page)).toBe(DARK);

    // Light stays light on a dark device.
    await choose(page, /^(Sáng|Light)/, "light");
    expect(await background(page)).toBe(LIGHT);
  } finally {
    // The cookie lives in this browser context; leave it at System.
    await choose(page, /^(Theo máy|System)/, "system");
  }
});
