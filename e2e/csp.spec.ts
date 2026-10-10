import { expect, test, type Page } from "@playwright/test";
import { staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";
import { framedPng } from "./support/files";
import { drawValuesPng, exportSheet, uploadSheet, waitForVersion } from "./support/sheets";

test.use({ viewport: { width: 1440, height: 900 } });

type Watch = { violations: () => Promise<string[]>; consoleErrors: string[] };

/** Collects every policy violation the page reports, as events and as console errors. */
async function watchPolicy(page: Page): Promise<Watch> {
  await page.addInitScript({
    content:
      "window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI))",
  });
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().includes("Content Security Policy")) consoleErrors.push(m.text());
  });
  return {
    consoleErrors,
    violations: async () => (await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])),
  };
}

async function expectNoViolations(watch: Watch) {
  expect(await watch.violations(), "securitypolicyviolation events").toEqual([]);
  expect(watch.consoleErrors, "console errors about the policy").toEqual([]);
}

test.afterEach(async () => {
  await deleteSheetsOf(await staffId());
});

test.describe("response header", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the login page carries a script policy with a fresh nonce on every load", async ({ page }) => {
    const first = await page.goto("/login");
    const second = await page.goto("/login");
    const policies = [first, second].map((r) => r!.headers()["content-security-policy"] ?? "");
    for (const policy of policies) {
      expect(policy).toContain("script-src");
      expect(policy).toContain("'nonce-");
      expect(policy).toContain("frame-ancestors 'none'");
    }
    const nonce = (p: string) => /'nonce-([^']+)'/.exec(p)?.[1];
    expect(nonce(policies[0])).toBeTruthy();
    expect(nonce(policies[0])).not.toBe(nonce(policies[1]));
  });

  test("a page that does not exist loads without a violation", async ({ page }) => {
    const watch = await watchPolicy(page);
    await page.goto("/no-such-page");
    await page.waitForLoadState("load");
    await expectNoViolations(watch);
  });
});

test("Staff: an uploaded sheet shows its thumbnail on the list with no violation", async ({ page }) => {
  const watch = await watchPolicy(page);
  await uploadSheet(page, `csp-thumb-${Date.now()}.png`, "image/png", framedPng(1135, 877));
  await page.goto("/sheets");
  await expect
    .poll(
      () => page.evaluate(() => [...document.images].some((img) => img.complete && img.naturalWidth > 0 && /supabase/.test(img.src))),
      { timeout: 30_000 },
    )
    .toBe(true);
  await expectNoViolations(watch);
});

test("Staff: OCR detection and PNG and PDF export run under the policy", async ({ page }, testInfo) => {
  test.setTimeout(420_000);
  const watch = await watchPolicy(page);
  await page.goto("/sheets");
  const png = await drawValuesPng(page);
  const { id } = await uploadSheet(page, `csp-ocr-${Date.now()}.png`, "image/png", png);
  await waitForVersion(id, 2, 240_000);
  await exportSheet(page, "png", testInfo);
  await exportSheet(page, "pdf", testInfo);
  await expectNoViolations(watch);
});

test.describe("Admin pages", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("the user, access, audit and trash pages load with no violation", async ({ page }) => {
    const watch = await watchPolicy(page);
    for (const path of ["/admin/users", "/admin/access", "/admin/audit", "/admin/trash"]) {
      await page.goto(path);
      await page.waitForLoadState("load");
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
    await expectNoViolations(watch);
  });
});
