import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ADMIN_EMAIL, STAFF_B_EMAIL, adminId, resetPassword, restoreStaff, staffBId, staffId } from "./support/account";
import { admin, deleteSheetsOf } from "./support/db";
import { framedPng, valuesPdf } from "./support/files";
import { TOP_LEFT, editValue, exportSheet, markers, openValuesSheet, storedSheet, uploadSheet, waitForVersion } from "./support/sheets";

const ADMIN_STATE = "e2e/.auth/admin.json";
const STAFF_STATE = "e2e/.auth/staff.json";
const STAFF_B_STATE = "e2e/.auth/staff-b.json";
const VIEWPORT = { width: 1440, height: 900 }; // the Admin area needs a screen at least 1024 px wide

test.use({ storageState: ADMIN_STATE, viewport: VIEWPORT });

/** A separate signed-in browser context (the config's baseURL and timeouts do not reach `browser.newContext`). */
async function contextAs(browser: Browser, state: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: "http://localhost:3000", storageState: state, viewport: VIEWPORT });
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(30_000);
  return context;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SAVED = /^(Đã lưu\.|Saved\.)$/;

// ---------- users ----------

type Kind = "role" | "status";
const LABELS: Record<Kind, string> = {
  role: "Đặt làm quản trị viên|Chuyển thành nhân viên|Make Admin|Make Staff",
  status: "Đình chỉ|Kích hoạt lại|Suspend|Reinstate",
};

/** Presses the row button for an account on /admin/users and confirms; waits for "Saved.". */
async function changeUser(page: Page, email: string, kind: Kind): Promise<void> {
  await page.goto("/admin/users");
  await page.getByRole("searchbox", { name: /Tìm theo tên hoặc email|Search by name or email/ }).fill(email);
  const button = page.getByRole("button", { name: new RegExp(`^(${LABELS[kind]}): ${escape(email)}$`) });
  await button.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: new RegExp(`^(${LABELS[kind]})$`) }).click();
  await expect(page.getByRole("status").filter({ hasText: SAVED })).toBeVisible();
}

const ROW_OF = (page: Page, email: string) => page.getByRole("row").filter({ hasText: email });

test.describe("as a Staff account", () => {
  test.use({ storageState: STAFF_STATE });

  test("TC-55 the Admin area answers Not found and the header has no Admin link", async ({ page }) => {
    const response = await page.goto("/admin/users");
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/This page could not be found|Not found/i).first()).toBeVisible();
    await page.goto("/sheets");
    await expect(page.getByRole("button", { name: /Tải phiếu lên|Upload sheet/ }).first()).toBeVisible();
    await expect(page.locator('header a[href="/admin"]')).toHaveCount(0);
    expect((await page.goto("/admin/audit"))?.status()).toBe(404);
  });
});

test("TC-58 the Admin makes Staff B an Admin; the Admin link appears and the change is audited", async ({ page, browser }) => {
  const staffB = await contextAs(browser, STAFF_B_STATE);
  try {
    const other = await staffB.newPage();
    await other.goto("/sheets");
    await expect(other.getByRole("button", { name: /Tải phiếu lên|Upload sheet/ }).first()).toBeVisible();
    await expect(other.locator('header a[href="/admin"]')).toHaveCount(0);

    const { data: before } = await admin().from("audit_log").select("id").eq("action", "user.role_change").order("id", { ascending: false }).limit(1);
    const lastId = before?.[0]?.id ?? 0;
    await changeUser(page, STAFF_B_EMAIL, "role");
    await expect(ROW_OF(page, STAFF_B_EMAIL)).toContainText(/Quản trị viên|Admin/);

    await other.reload();
    await expect(other.locator('header a[href="/admin"]')).toBeVisible();

    const { data, error } = await admin().from("audit_log").select("actor_id, actor_email, detail, target_id").eq("action", "user.role_change").gt("id", lastId);
    if (error) throw new Error(`audit log not read: ${error.message}`);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ actor_id: await adminId(), actor_email: ADMIN_EMAIL, target_id: await staffBId() });
    expect(data![0].detail).toMatchObject({ email: STAFF_B_EMAIL, from: "user", to: "admin" });

    await changeUser(page, STAFF_B_EMAIL, "role"); // back to Staff
    await expect(ROW_OF(page, STAFF_B_EMAIL)).toContainText(/Nhân viên|Staff/);
    await other.reload();
    await expect(other.locator('header a[href="/admin"]')).toHaveCount(0);
  } finally {
    await staffB.close();
    await restoreStaff(STAFF_B_EMAIL);
  }
});

test("TC-62 / TC-63 a suspended person is stopped at the next save, cannot sign in, and can after reinstating", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const staff = await contextAs(browser, STAFF_STATE);
  const staffB = await contextAs(browser, STAFF_B_STATE);
  try {
    const owner = await staff.newPage();
    const { id } = await openValuesSheet(owner, "tc62");
    const other = await staffB.newPage();
    await other.goto(`/sheets/${id}`);
    await expect(markers(other)).toHaveCount(11, { timeout: 30_000 });
    await editValue(other, "6.90", TOP_LEFT, "7.1");

    await changeUser(page, STAFF_B_EMAIL, "status"); // suspend
    await expect(ROW_OF(page, STAFF_B_EMAIL)).toContainText(/Bị đình chỉ|Suspended/);

    await other.keyboard.press("Control+s");
    await other.waitForURL(/\/login/);
    await expect(other.getByText(/đã bị khoá|has been suspended/)).toBeVisible();
    const stored = await storedSheet(id);
    expect(stored.version).toBe(2);
    expect(stored.edits).toEqual([]);

    // TC-63: signing in again is refused with the same message.
    const password = await resetPassword(STAFF_B_EMAIL);
    await other.locator("#email").fill(STAFF_B_EMAIL);
    await other.locator("#password").fill(password);
    await other.locator("form", { has: other.locator("#password") }).locator('button[type="submit"]').click();
    await expect(other.getByText(/đã bị khoá|has been suspended/)).toBeVisible();
    await expect(other).toHaveURL(/\/login/);

    await changeUser(page, STAFF_B_EMAIL, "status"); // reinstate
    await expect(ROW_OF(page, STAFF_B_EMAIL)).toContainText(/Đang hoạt động|Active/);
    await other.locator("#password").fill(password);
    await other.locator("form", { has: other.locator("#password") }).locator('button[type="submit"]').click();
    await other.waitForURL("**/sheets");
    await staffB.storageState({ path: STAFF_B_STATE }); // keep the saved session valid for the other specs
  } finally {
    await staff.close();
    await staffB.close();
    await restoreStaff(STAFF_B_EMAIL);
    await deleteSheetsOf(await staffId());
  }
});

// ---------- settings ----------

type Settings = { key: string; value: number }[];

async function readSettings(): Promise<Settings> {
  const { data, error } = await admin().from("app_settings").select("key, value");
  if (error) throw new Error(`settings not read: ${error.message}`);
  return data.map((r) => ({ key: r.key as string, value: Number(r.value) }));
}

async function writeSetting(key: string, value: number): Promise<void> {
  const { error } = await admin().from("app_settings").update({ value }).eq("key", key);
  if (error) throw new Error(`setting ${key} not written: ${error.message}`);
}

async function restoreSettings(previous: Settings): Promise<void> {
  for (const s of previous) await writeSetting(s.key, s.value);
}

const settingValue = async (key: string) => (await readSettings()).find((s) => s.key === key)?.value;

async function saveSetting(page: Page, label: RegExp, value: string): Promise<void> {
  await page.goto("/admin/access");
  await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: /^(Lưu cài đặt|Save settings)$/ }).click();
}

const RANGE = /(Giá trị phải từ|The value must be between) \d/;

test.describe("settings seen by Staff", () => {
  test.use({ storageState: STAFF_STATE });
  test.afterEach(async () => {
    await deleteSheetsOf(await staffId());
  });

  test("TC-66 the maximum file size applies to uploads and refuses values out of range", async ({ page, browser }) => {
    const previous = await readSettings();
    const adminContext = await contextAs(browser, ADMIN_STATE);
    try {
      const settings = await adminContext.newPage();
      const label = /Dung lượng tệp tối đa|Maximum file size/;
      await saveSetting(settings, label, "5");
      await expect(settings.getByRole("status").filter({ hasText: /Đã lưu cài đặt|Settings saved/ })).toBeVisible();
      expect(await settingValue("max_file_mb")).toBe(5);

      await page.goto("/sheets");
      await page.getByRole("button", { name: /Tải phiếu lên|Upload sheet/ }).first().click();
      const dialog = page.getByRole("dialog");
      await page.locator("#upload-file").setInputFiles({ name: "six.png", mimeType: "image/png", buffer: Buffer.alloc(6 * 1024 * 1024, 0x20) });
      await expect(dialog.getByRole("alert")).toContainText(/Tệp này nặng 6 MB; giới hạn là 5 MB\.|This file is 6 MB; the limit is 5 MB\./);

      for (const bad of ["0", "60"]) {
        await settings.getByLabel(label).fill(bad);
        await settings.getByRole("button", { name: /^(Lưu cài đặt|Save settings)$/ }).click();
        await expect(settings.getByText(RANGE)).toBeVisible();
        expect(await settingValue("max_file_mb")).toBe(5); // nothing was saved
      }
    } finally {
      await adminContext.close();
      await restoreSettings(previous);
    }
  });

  test("TC-67 the template ratio tolerance decides whether a 1.330 image is accepted", async ({ page, browser }) => {
    const previous = await readSettings();
    const adminContext = await contextAs(browser, ADMIN_STATE);
    try {
      await writeSetting("aspect_tolerance_pct", 2);
      const upload = async () => {
        await page.goto("/sheets");
        await page.getByRole("button", { name: /Tải phiếu lên|Upload sheet/ }).first().click();
        const dialog = page.getByRole("dialog");
        await page.locator("#upload-file").setInputFiles({ name: "ratio.png", mimeType: "image/png", buffer: framedPng(1330, 1000) });
        return dialog;
      };
      const refused = await upload();
      await expect(refused.getByRole("alert")).toContainText(/mẫu phiếu|sheet template/);

      const settings = await adminContext.newPage();
      await saveSetting(settings, /Sai lệch tỉ lệ|Template ratio tolerance/, "3");
      await expect(settings.getByRole("status").filter({ hasText: /Đã lưu cài đặt|Settings saved/ })).toBeVisible();
      expect(await settingValue("aspect_tolerance_pct")).toBe(3);

      const accepted = await upload();
      await accepted.getByRole("button", { name: /^(Tải lên|Upload)$/ }).click();
      await page.waitForURL(/\/sheets\/[0-9a-f-]{36}$/);
    } finally {
      await adminContext.close();
      await restoreSettings(previous);
    }
  });
});

// ---------- access lists ----------

test("Access lists: add a domain and an email, refuse a duplicate and a bad value, then remove both", async ({ page }) => {
  const domain = "e2e-example.test";
  const email = "technician@workshop.example";
  const clean = async () => {
    const d = await admin().from("allowed_domains").delete().eq("domain", domain);
    const e = await admin().from("allowed_emails").delete().eq("email", email);
    if (d.error || e.error) throw new Error(`access entries not removed: ${d.error?.message ?? e.error?.message}`);
  };
  await clean();
  try {
    await page.goto("/admin/access");
    const value = page.getByLabel(/^(Tên miền hoặc email|Domain or email)$/);
    const add = page.getByRole("button", { name: /^(Thêm|Add)$/ });
    const kind = page.getByLabel(/^(Loại|Kind)$/);

    await value.fill(domain);
    await add.click();
    await expect(page.getByRole("status").filter({ hasText: new RegExp(escape(domain)) })).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: domain });
    await expect(row).toContainText(/0 tài khoản|0 account\(s\)/);

    await value.fill(domain);
    await add.click();
    await expect(page.getByText(/Mục này đã có trong danh sách|This entry is already on the list/)).toBeVisible();

    await value.fill("not a domain");
    await add.click();
    await expect(page.getByText(/Nhập tên miền, ví dụ|Enter a domain such as/)).toBeVisible();

    await kind.selectOption("email");
    await value.fill(email);
    await add.click();
    await expect(page.getByRole("status").filter({ hasText: new RegExp(escape(email)) })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: email })).toContainText(/0 tài khoản|0 account\(s\)/);

    for (const entry of [domain, email]) {
      await page.getByRole("button", { name: new RegExp(`^(Gỡ|Remove): ${escape(entry)}$`) }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText(/0 tài khoản sẽ mất quyền truy cập|0 account\(s\) will lose access/);
      await dialog.getByRole("button", { name: /^(Gỡ|Remove)$/ }).click();
      await expect(page.getByRole("status").filter({ hasText: /^(Đã gỡ|Removed) / })).toContainText(entry);
      await expect(page.getByRole("listitem").filter({ hasText: entry })).toHaveCount(0);
    }
  } finally {
    await clean();
  }
});

// ---------- audit log, trash, purge, orphans ----------

/** Today's date in Ho Chi Minh City, as the audit filter reads it. */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const WATCHED = ["sheet.upload", "sheet.detect", "sheet.save", "sheet.export_png", "sheet.restore", "sheet.purge", "sheet.trash", "user.role_change"] as const;

/** How many rows of each watched action the Admin has written today (Ho Chi Minh City). */
async function adminAuditToday(): Promise<Record<string, number>> {
  const day = today();
  const from = new Date(new Date(`${day}T00:00:00Z`).getTime() - 7 * 3_600_000).toISOString();
  const to = new Date(new Date(`${day}T00:00:00Z`).getTime() + 17 * 3_600_000).toISOString();
  const counts: Record<string, number> = Object.fromEntries(WATCHED.map((a) => [a, 0]));
  for (const action of WATCHED) {
    const { count, error } = await admin().from("audit_log").select("id", { count: "exact", head: true })
      .eq("actor_id", await adminId()).eq("action", action).gte("occurred_at", from).lt("occurred_at", to);
    if (error) throw new Error(`audit log not read: ${error.message}`);
    counts[action] = count ?? 0;
  }
  return counts;
}

async function trashFromList(page: Page, name: string): Promise<void> {
  await page.goto("/sheets");
  await page.getByRole("searchbox").fill(name);
  await page.getByRole("button", { name: new RegExp(escape(name)) }).click(); // the row's ⋯ menu
  await page.getByRole("menuitem", { name: /Đưa vào Thùng rác|Move to Trash/ }).click();
  await expect(page.getByRole("status")).toBeVisible();
}

async function restoreFromTrash(page: Page, name: string): Promise<void> {
  await page.goto("/sheets");
  await page.getByRole("tab", { name: /Thùng rác|Trash/ }).click();
  await page.locator("li", { hasText: name }).getByRole("button", { name: /Khôi phục|Restore/ }).click();
  await expect(page.getByRole("status")).toContainText(/khôi phục|restored/i);
}

/** Opens the permanent-deletion dialog for a sheet on /admin/trash. */
async function openPurge(page: Page, name: string) {
  await page.goto("/admin/trash");
  await page.getByRole("button", { name: new RegExp(`^(Xoá vĩnh viễn|Delete permanently): ${escape(name)}$`) }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += c;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

test("TC-68 / TC-72 every Admin action is audited once, and the CSV matches the log", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const name = `Nhẫn thử ${Date.now()}`;
  const before = await adminAuditToday();
  try {
    const sheet = await uploadSheet(page, `${name}.pdf`, "application/pdf", await valuesPdf());
    await expect(markers(page)).toHaveCount(11, { timeout: 30_000 });
    await waitForVersion(sheet.id, 2);
    await editValue(page, "6.90", TOP_LEFT, "7.1");
    await page.keyboard.press("Control+s");
    await waitForVersion(sheet.id, 3);
    await exportSheet(page, "png", testInfo);
    await trashFromList(page, name);
    await restoreFromTrash(page, name);
    await trashFromList(page, name);
    const dialog = await openPurge(page, name);
    await dialog.getByLabel(/Nhập lại tên phiếu|Type the sheet name/).fill(name);
    await dialog.getByRole("button", { name: /^(Xoá vĩnh viễn|Delete permanently)$/ }).click();
    await expect(page.getByRole("status").filter({ hasText: /Đã xoá vĩnh viễn|permanently deleted/ })).toBeVisible();
    await changeUser(page, STAFF_B_EMAIL, "role");
    await changeUser(page, STAFF_B_EMAIL, "role");

    const expected: Record<string, number> = {
      "sheet.upload": 1, "sheet.detect": 1, "sheet.save": 1, "sheet.export_png": 1, "sheet.restore": 1, "sheet.purge": 1, "sheet.trash": 2, "user.role_change": 2,
    };
    const after = await adminAuditToday();
    for (const action of WATCHED) expect(after[action] - before[action], action).toBe(expected[action]);

    // The audit page, filtered to today and the Admin, shows the same numbers.
    const day = today();
    await page.goto("/admin/audit");
    await page.getByLabel(/^(Từ ngày|From)$/).fill(day);
    await page.getByLabel(/^(Đến ngày|To)$/).fill(day);
    await page.locator('select[name="actor"]').selectOption(await adminId());
    await page.getByRole("button", { name: /^(Lọc|Apply)$/ }).click();
    await page.waitForURL(/actor=/);
    const shown: Record<string, number> = {};
    for (;;) {
      for (const action of await page.locator("tbody tr td:nth-child(3)").allTextContents()) shown[action] = (shown[action] ?? 0) + 1;
      const older = page.getByRole("link", { name: /Xem các mục cũ hơn|Show older entries/ });
      if ((await older.count()) === 0) break;
      const here = page.url();
      await older.click();
      await page.waitForURL((u) => u.href !== here);
    }
    for (const action of WATCHED) expect(shown[action] ?? 0, `${action} on the page`).toBe(after[action]);

    // The CSV: UTF-8 BOM, the header, only the Admin's rows, and the sheet's name.
    await page.goto(page.url().split("&before=")[0]);
    const count = Number((await page.getByText(/^(Số mục|Entries): /).innerText()).replace(/\D/g, ""));
    const downloading = page.waitForEvent("download");
    await page.getByRole("link", { name: /^(Tải CSV|Download CSV)$/ }).click();
    const download = await downloading;
    const path = testInfo.outputPath("audit.csv");
    await download.saveAs(path);
    const bytes = readFileSync(path);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = parseCsv(bytes.toString("utf8").slice(1)).filter((r) => r.length > 1 || r[0] !== "");
    expect(rows[0]).toEqual(["occurred_at", "actor_email", "action", "target_type", "target_id", "detail"]);
    expect(rows.length - 1).toBe(count);
    for (const r of rows.slice(1)) expect(r[1]).toBe(ADMIN_EMAIL);
    expect(bytes.toString("utf8")).toContain("Nhẫn thử");
  } finally {
    await restoreStaff(STAFF_B_EMAIL);
    await deleteSheetsOf(await adminId());
  }
});

test("TC-74 permanent deletion needs the typed name and removes the record and both files", async ({ page }) => {
  test.setTimeout(240_000);
  const { id, name } = await openValuesSheet(page, "tc74");
  try {
    const { data: row, error } = await admin().from("spec_sheets").select("source_path, thumb_path").eq("id", id).single();
    if (error) throw new Error(`sheet not read: ${error.message}`);
    const bucket = admin().storage.from("spec-sheets");
    expect((await bucket.list(id)).data?.length).toBe(2);
    await trashFromList(page, name);

    const dialog = await openPurge(page, name);
    const input = dialog.getByLabel(/Nhập lại tên phiếu|Type the sheet name/);
    const confirm = dialog.getByRole("button", { name: /^(Xoá vĩnh viễn|Delete permanently)$/ });
    await expect(confirm).toBeDisabled();
    await input.fill(`${name} x`);
    await expect(confirm).toBeDisabled();
    await input.fill(name.slice(0, -1));
    await expect(confirm).toBeDisabled();
    await input.fill(name);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByRole("status").filter({ hasText: /Đã xoá vĩnh viễn|permanently deleted/ })).toBeVisible();

    const { data: gone, error: goneError } = await admin().from("spec_sheets").select("id").eq("id", id);
    if (goneError) throw new Error(`sheet not read: ${goneError.message}`);
    expect(gone).toEqual([]);
    expect((await bucket.list(id)).data).toEqual([]);
    const { data: audit, error: auditError } = await admin().from("audit_log").select("detail, actor_id").eq("action", "sheet.purge").eq("target_id", id);
    if (auditError) throw new Error(`audit log not read: ${auditError.message}`);
    expect(audit).toHaveLength(1);
    expect(audit![0].detail).toMatchObject({ name, source_path: row.source_path });
    expect(audit![0].actor_id).toBe(await adminId());
  } finally {
    await deleteSheetsOf(await adminId());
  }
});

test("TC-76 a fresh folder with no sheet record is not offered as an orphan", async ({ page }) => {
  const folder = randomUUID();
  const path = `${folder}/source.png`;
  const bucket = admin().storage.from("spec-sheets");
  const check = page.getByRole("button", { name: /^(Kiểm tra tệp mồ côi|Check for orphan files)$/ });
  const reading = async () => {
    await check.click();
    const found = page.getByText(/^\d+ (thư mục|folder\(s\)), /);
    const none = page.getByText(/^(Không có tệp mồ côi\.|No orphan files\.)$/);
    await expect(found.or(none)).toBeVisible();
    return (await none.count()) > 0 ? "none" : await found.innerText();
  };
  try {
    await page.goto("/admin/trash");
    const baseline = await reading(); // folders older than 24 hours that belong to other people's work stay as they are
    const { error } = await bucket.upload(path, framedPng(8, 8), { contentType: "image/png" });
    if (error) throw new Error(`orphan fixture not uploaded: ${error.message}`);
    expect((await bucket.list(folder)).data?.length).toBe(1);
    expect(await reading()).toBe(baseline);
    expect((await bucket.list(folder)).data?.length).toBe(1); // checking deletes nothing
  } finally {
    await bucket.remove([path]);
  }
});
