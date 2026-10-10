import { expect, test, type Page } from "@playwright/test";
import { staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";
import { markers, openValuesSheet, storedSheet, waitForVersion } from "./support/sheets";

test.use({ viewport: { width: 1440, height: 900 } });

test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
});

type Active = { tag: string; text: string; detection: string | null; popup: string | null; type: string | null };

const active = (page: Page): Promise<Active> =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    return {
      tag: el.tagName,
      text: (el.textContent ?? "").trim(),
      detection: el.getAttribute("data-detection"),
      popup: el.getAttribute("aria-haspopup"),
      type: el.getAttribute("type"),
    };
  });

/** The focused element shows a focus indicator: a real outline, or a shadow standing in for it. */
async function expectFocusRing(page: Page, what: string): Promise<void> {
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return { tag: el.tagName, outlineStyle: s.outlineStyle, outlineWidth: parseFloat(s.outlineWidth), boxShadow: s.boxShadow };
  });
  const visible = (ring.outlineStyle !== "none" && ring.outlineWidth > 0) || ring.boxShadow !== "none";
  expect(visible, `${what}: focus indicator ${JSON.stringify(ring)}`).toBe(true);
}

/** Presses Tab until the focused element matches; every control passed on the way must show focus. */
async function tabTo(page: Page, what: string, matches: (a: Active) => boolean, max = 150): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const tag = (await active(page)).tag;
    if (tag === "NEXTJS-PORTAL" || tag === "BODY") continue; // the development overlay, or Tab leaving the page and coming round again
    await expectFocusRing(page, `${what} (Tab ${i + 1})`);
    if (matches(await active(page))) return;
  }
  throw new Error(`${what}: not reached with ${max} Tab presses`);
}

test("NFR-07 a sheet is opened, a value edited and saved, and exported with the keyboard alone", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const { id, name } = await openValuesSheet(page, "kbd");
  await page.goto("/sheets");
  await expect(page.getByRole("link", { name }).first()).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // Tab starts from the top of the page

  // 1. Tab to the sheet and open it.
  await tabTo(page, "the sheet link", (a) => a.tag === "A" && a.text === name);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/sheets\/[0-9a-f-]{36}$/);
  await expect(markers(page)).toHaveCount(11, { timeout: 30_000 });

  // 2. A marker (the value list's keyboard route), Enter, a new value, Enter, Ctrl+S.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await tabTo(page, "a value marker", (a) => a.detection !== null);
  await page.keyboard.press("Enter");
  const popover = page.getByRole("dialog", { name: /Sửa kích thước|Edit dimension/ });
  await expect(popover).toBeVisible();
  const newValue = popover.getByLabel(/Số mới|New value/);
  await expect(newValue).toBeFocused();
  await expectFocusRing(page, "the new value field");
  await page.keyboard.type("9.99");
  await page.keyboard.press("Enter");
  await expect(popover).toBeHidden();
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/Đã lưu lúc|Saved at/)).toBeVisible();
  await waitForVersion(id, 3);
  expect((await storedSheet(id)).edits.map((e) => e.newValue)).toContain("9.99");

  // 4a. Escape closes the popover and focus goes back to the marker that opened it.
  const first = page.locator("[data-detection]").first();
  await first.focus();
  await expectFocusRing(page, "a value marker");
  await page.keyboard.press("Enter");
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(first).toBeFocused();

  // 3 + 4b. Export menu -> Escape closes it and focus returns to the Export button.
  const exportButton = page.getByRole("button", { name: /^(Xuất|Export)$/ });
  await tabTo(page, "the Export button", (a) => a.popup === "menu" && /^(Xuất|Export)$/.test(a.text));
  await expect(exportButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expectFocusRing(page, "the first menu item");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(exportButton).toBeFocused();

  // 4c. Choose PNG; Escape closes the check dialog and focus returns to the Export button.
  const dialog = page.getByRole("dialog", { name: /Kiểm tra trước khi xuất|Check before exporting/ });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: /Ảnh PNG|PNG image/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(exportButton).toBeFocused();

  // 3. Again, and confirm: a download happens.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  const downloading = page.waitForEvent("download", { timeout: 60_000 });
  await tabTo(page, "the Export PNG button", (a) => a.tag === "BUTTON" && /^(Xuất|Export) PNG$/.test(a.text), 20);
  await page.keyboard.press("Enter");
  const download = await downloading;
  await download.saveAs(testInfo.outputPath(download.suggestedFilename()));
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});
