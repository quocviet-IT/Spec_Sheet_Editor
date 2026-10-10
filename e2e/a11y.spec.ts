import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminId, staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";
import { TOP_LEFT, dragBox, editValue, marker, openExportCheck, openValuesSheet } from "./support/sheets";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const THEMES = ["light", "dark"] as const;
type Locale = "vi" | "en";

test.use({ viewport: { width: 1440, height: 900 } });

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function setLocale(page: Page, locale: Locale): Promise<void> {
  await page.context().addCookies([{ name: "locale", value: locale, url: "http://localhost:3000" }]);
}

/** Scans the screen as it is now and returns one line per violation. Canvas is the only exclusion: the sheet image is a picture of a paper document. */
async function scan(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).exclude("canvas").analyze();
  return result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

/** Scans the open screen in light and dark and saves a screenshot of each. Returns every violation, labelled. */
async function scanBothThemes(page: Page, label: string, locale: Locale): Promise<string[]> {
  const found: string[] = [];
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: `test-results/a11y/${label}-${theme}-${locale}.png` });
    for (const line of await scan(page)) found.push(`${label} / ${theme} / ${locale}: ${line}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  return found;
}

/** Collects the violations of every step, so one run lists every violation on every screen. */
function steps(page: Page, locale: Locale) {
  const failures: string[] = [];
  return {
    failures,
    step: async (label: string) => {
      failures.push(...(await scanBothThemes(page, label, locale)));
    },
  };
}

async function trashFromList(page: Page, name: string): Promise<void> {
  await page.goto("/sheets");
  await page.getByRole("searchbox").fill(name);
  await page.getByRole("button", { name: new RegExp(escape(name)) }).click(); // the row's menu
  await page.getByRole("menuitem", { name: /Đưa vào Thùng rác|Move to Trash/ }).click();
  await expect(page.getByRole("status").filter({ hasText: /Thùng rác|Trash/ })).toBeVisible();
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const locale of ["vi", "en"] as const) {
    test(`/login (${locale})`, async ({ page }) => {
      await setLocale(page, locale);
      await page.goto("/login");
      await expect(page.getByRole("button").first()).toBeVisible();
      expect(await scanBothThemes(page, "login", locale)).toEqual([]);
    });
  }
});

test.describe("as Staff", () => {
  test.afterEach(async () => {
    await deleteSheetsOf(await staffId());
  });

  for (const locale of ["vi", "en"] as const) {
    test(`sheet list, upload dialog, editor and its layers, trash (${locale})`, async ({ page }) => {
      test.setTimeout(360_000);
      await setLocale(page, locale);
      const { step, failures } = steps(page, locale);

      await page.goto("/sheets");
      await page.getByRole("button", { name: /Tải phiếu lên|Upload sheet/ }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await step("upload-dialog");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const { name } = await openValuesSheet(page, `a11y-${locale}`);
      await step("editor");

      await marker(page, "6.90", TOP_LEFT).click();
      await expect(page.getByRole("dialog", { name: /Sửa kích thước|Edit dimension/ })).toBeVisible();
      await step("edit-popover");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await page.getByRole("button", { name: /^(Vẽ khung|Draw box)/ }).click();
      await dragBox(page, 0.3, 0.39, 0.34, 0.42);
      await expect(page.getByRole("dialog", { name: /Chiều của số|Direction of the value/ })).toBeVisible();
      await step("angle-dialog");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const draw = page.getByRole("button", { name: /^(Vẽ khung|Draw box)/ });
      if ((await draw.getAttribute("aria-pressed")) === "true") await draw.click();

      await editValue(page, "2.50", TOP_LEFT, "2.6");
      await expect(page.getByRole("dialog", { name: /Số trùng|Same value elsewhere/ })).toBeVisible();
      await step("matching-prompt");
      await page.keyboard.press("Escape");

      await openExportCheck(page, "png");
      await step("export-check");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      await page.keyboard.press("Control+s");
      await expect(page.getByText(/Đã lưu lúc|Saved at/)).toBeVisible();
      await page.goto("/sheets");
      await expect(page.getByText(name).first()).toBeVisible();
      await step("sheets");

      await trashFromList(page, name);
      await page.getByRole("tab", { name: /Thùng rác|Trash/ }).click();
      await expect(page.locator("li", { hasText: name }).getByRole("button", { name: /Khôi phục|Restore/ })).toBeVisible();
      await step("trash");

      expect(failures, failures.join("\n\n")).toEqual([]);
    });
  }

  for (const [path, label] of [["/account/password", "account-password"], ["/guide", "guide"]] as const) {
    for (const locale of ["vi", "en"] as const) {
      test(`${path} (${locale})`, async ({ page }) => {
        await setLocale(page, locale);
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await scanBothThemes(page, label, locale)).toEqual([]);
      });
    }
  }
});

test.describe("as Admin", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test.afterEach(async () => {
    await deleteSheetsOf(await adminId());
  });

  test("Admin screens and the purge dialog", async ({ page }) => {
    test.setTimeout(300_000);
    await setLocale(page, "en");
    const { step, failures } = steps(page, "en");

    // A trashed sheet, so that the Admin trash has a row to purge.
    const { name } = await openValuesSheet(page, `a11y-admin`);
    await trashFromList(page, name);

    for (const path of ["/admin/users", "/admin/access", "/admin/audit", "/admin/trash"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await step(path.slice(1).replace("/", "-"));
    }
    await page.getByRole("button", { name: /^(Xoá vĩnh viễn|Delete permanently)/ }).first().click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await step("admin-purge-dialog");
    await page.keyboard.press("Escape");

    expect(failures, failures.join("\n\n")).toEqual([]);
  });
});
