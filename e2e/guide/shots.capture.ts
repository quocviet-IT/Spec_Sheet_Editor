import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { adminId, staffId } from "../support/account";
import { deleteSheetsOf } from "../support/db";
import { PDF_VALUES, valuesPdf } from "../support/files";
import { TOP_LEFT, dragBox, editValue, textPng, marker, markers, openExportCheck, uploadSheet, waitForVersion } from "../support/sheets";

/**
 * Makes the screenshots of the user guide, once per language (`npm run guide:shots`). Only synthetic sheets and the
 * reserved e2e accounts appear in them. Light theme, 1440 x 900; a shot may be cut to a 16:10 clip around the part
 * that matters. Callout positions are written as percentages of each image, from the targets' bounding boxes.
 */

const BASE = "http://localhost:3000";
const VIEWPORT = { width: 1440, height: 900 };
const STAFF_STATE = "e2e/.auth/staff.json";
const ADMIN_STATE = "e2e/.auth/admin.json";
const LOCALES = ["vi", "en"] as const;
type Locale = (typeof LOCALES)[number];
type Clip = { x: number; y: number; width: number; height: number };
/** A target whose circle goes on its right (the default is its left), for a button standing right beside another. */
class Right {
  constructor(readonly locator: Locator) {}
}
/** A target whose circle goes just above it (buttons side by side in a row). */
class Above {
  constructor(readonly locator: Locator) {}
}
/**
 * The circle as the page draws it at the widest: 24 CSS px across, with the image shown at most 880 px wide. The page shrinks the
 * circle on narrow screens, so a circle placed clear of its control here is clear of it at any width.
 */
const COLUMN_PX = 880;
const CIRCLE_CSS_PX = 24;
const GAP_CSS_PX = 6;
/** Controls a circle must never cover. */
const CONTROLS = 'button, input, textarea, select, a[href], [role="tab"], [role="radio"], [role="menuitem"]';

type Point = { n: number; x: number; y: number };

const round1 = (v: number) => Math.round(v * 10) / 10;

class Shots {
  readonly points: Record<string, Point[]> = {};
  constructor(private readonly locale: Locale) {}

  /** A 16:10 clip of `width` px centred on a box, kept inside the viewport. */
  static clipAround(box: { x: number; y: number; width: number; height: number }, width = 960, tall?: number): Clip {
    const height = tall ?? (width * 10) / 16;
    const x = Math.min(Math.max(0, box.x + box.width / 2 - width / 2), VIEWPORT.width - width);
    const y = Math.min(Math.max(0, box.y + box.height / 2 - height / 2), VIEWPORT.height - height);
    return { x: Math.round(x), y: Math.round(y), width, height };
  }

  /** Takes the picture, then measures every target (numbered 1, 2, 3 in order) against the clip. */
  async take(page: Page, name: string, targets: (Locator | Right | Above)[], clip?: Clip): Promise<void> {
    await page.mouse.move(VIEWPORT.width - 4, VIEWPORT.height - 4); // no stray hover state
    await page.waitForTimeout(250);
    const area = clip ?? { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height };
    const dir = `src/app/(app)/guide/shots/${this.locale}`;
    await mkdir(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/${name}.jpg`, type: "jpeg", quality: 80, clip: area, style: "nextjs-portal { display: none !important }" });
    const scale = Math.min(1, COLUMN_PX / area.width);
    const diameter = CIRCLE_CSS_PX / scale; // in page px, which are image px
    const offset = diameter / 2 + GAP_CSS_PX / scale;
    const controls: { x: number; y: number; width: number; height: number }[] = [];
    for (const control of await page.locator(CONTROLS).all()) {
      const box = await control.boundingBox({ timeout: 1000 }).catch(() => null); // a control may go away while we read
      if (box && box.width > 0 && box.height > 0) controls.push(box);
    }
    const points: Point[] = [];
    for (const [i, item] of targets.entries()) {
      const target = item instanceof Right || item instanceof Above ? item.locator : item;
      await expect(target, `target ${i + 1} of ${name}`).toBeVisible();
      const box = await target.boundingBox();
      if (!box) throw new Error(`target ${i + 1} of ${name} has no box`);
      // The point is the CENTRE of the circle, clear of its control.
      let cx = box.x - offset;
      let cy = box.y + box.height / 2;
      if (item instanceof Right) cx = box.x + box.width + offset;
      if (item instanceof Above) {
        cx = box.x + box.width / 2;
        cy = box.y - offset;
      }
      const r = diameter / 2;
      if (cx - r < area.x || cx + r > area.x + area.width || cy - r < area.y || cy + r > area.y + area.height) {
        throw new Error(`callout ${i + 1} of ${name} would leave the picture (${Math.round(cx)}, ${Math.round(cy)})`);
      }
      const hit = controls.find((c) => cx + r > c.x && cx - r < c.x + c.width && cy + r > c.y && cy - r < c.y + c.height);
      if (hit) throw new Error(`callout ${i + 1} of ${name} would cover a control at ${Math.round(hit.x)}, ${Math.round(hit.y)} (${Math.round(hit.width)} x ${Math.round(hit.height)})`);
      points.push({ n: i + 1, x: round1(((cx - area.x) / area.width) * 100), y: round1(((cy - area.y) / area.height) * 100) });
    }
    // On a phone (a 328 px column) the circles are 16 px: they must not touch each other even there.
    const phoneDiameter = (16 * area.width) / 328;
    for (const [i, a] of points.entries()) {
      for (const b of points.slice(i + 1)) {
        const dx = ((a.x - b.x) / 100) * area.width;
        const dy = ((a.y - b.y) / 100) * area.height;
        if (Math.hypot(dx, dy) < phoneDiameter) throw new Error(`callouts ${a.n} and ${b.n} of ${name} would overlap on a phone`);
      }
    }
    this.points[name] = points;
  }

  async save(): Promise<void> {
    const ordered = Object.fromEntries(Object.entries(this.points));
    await writeFile(`src/app/(app)/guide/shots/${this.locale}/points.json`, JSON.stringify(ordered, null, 2) + "\n", "utf8");
  }
}

async function context(browser: Browser, locale: Locale, state?: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: VIEWPORT, colorScheme: "light", storageState: state });
  ctx.setDefaultTimeout(30_000);
  ctx.setDefaultNavigationTimeout(120_000);
  await ctx.addCookies([{ name: "locale", value: locale, url: BASE }]);
  return ctx;
}

/** Uploads a synthetic sheet whose 1.70 is a picture (so it has no marker), under a readable name. */
async function openSheet(page: Page, name: string): Promise<string> {
  await page.goto("/sheets");
  const image = await textPng(page, "1.70");
  const sheet = await uploadSheet(page, `${name}.pdf`, "application/pdf", await valuesPdf({ asImage: { value: "1.70", ...image } }));
  await expect(markers(page)).toHaveCount(10, { timeout: 60_000 });
  await waitForVersion(sheet.id, 2);
  return sheet.id;
}

const button = (page: Page, name: RegExp) => page.getByRole("button", { name });

for (const locale of LOCALES) {
  test(`guide screenshots (${locale})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const shots = new Shots(locale);
    const staffCtx = await context(browser, locale, STAFF_STATE);
    const adminCtx = await context(browser, locale, ADMIN_STATE);
    const anonCtx = await context(browser, locale);
    try {
      // 1. login --------------------------------------------------------------------------------------------------
      {
        const page = await anonCtx.newPage();
        await page.goto("/login", { timeout: 180_000 });
        const card = page.locator("#email").locator("xpath=ancestor::div[contains(@class,'rounded-xl')]");
        await expect(card).toBeVisible();
        const form = page.locator("form", { has: page.locator("#password") });
        await shots.take(
          page,
          "login",
          [page.locator("#email"), page.locator("#password"), form.locator('button[type="submit"]'), page.getByRole("group", { name: /Ngôn ngữ|Language/ })],
          Shots.clipAround((await card.boundingBox())!, 720),
        );
        await page.close();
      }

      // 2. the upload dialog, with a file chosen ------------------------------------------------------------------
      const staff = await staffCtx.newPage();
      staff.on("dialog", (d) => void d.accept()); // "leave this page?" when an edit is unsaved
      {
        await staff.goto("/sheets", { timeout: 180_000 });
        await button(staff, /Tải phiếu lên|Upload sheet/).first().click();
        const dialog = staff.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await staff.locator("#upload-file").setInputFiles({ name: "Ring-RG-1042.pdf", mimeType: "application/pdf", buffer: await valuesPdf() });
        await expect(dialog.getByRole("button", { name: /^(Tải lên|Upload)$/ })).toBeEnabled();
        const nameField = dialog.getByLabel(/Tên phiếu|Sheet name/);
        await expect(nameField).toHaveValue("Ring-RG-1042");
        await shots.take(
          staff,
          "upload",
          [
            new Right(dialog.getByText(/Kiểm tra mẫu phiếu|Check the sheet template/)),
            dialog.getByText(/Ring-RG-1042.pdf/),
            nameField,
            new Right(dialog.getByRole("button", { name: /^(Tải lên|Upload)$/ })),
          ],
          Shots.clipAround((await dialog.boundingBox())!),
        );
        await staff.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      }

      // 3. the editor, the popover, the angle dialog and the export check -----------------------------------------
      const sheetId = await openSheet(staff, "Ring RG-1042");
      await editValue(staff, "6.90", TOP_LEFT, "7.10");
      await staff.keyboard.press("Control+s");
      await waitForVersion(sheetId, 3);
      await expect(markers(staff)).toHaveCount(10);
      {
        await staff.locator(":focus").blur(); // no focus ring on the marker just edited
        await shots.take(staff, "editor", [
          marker(staff, "16.30", /./),
          staff.locator("#values-title").locator("xpath=following::li[1]"),
          button(staff, /^(Vẽ khung|Draw box)/),
          new Above(staff.getByText(/Thu phóng \d+%|Zoom \d+%/)),
        ]);
      }
      {
        await marker(staff, "7.10", /./).or(staff.getByRole("button", { name: /^(Số|Value) 6\.90, .*(đã sửa thành|edited to) 7\.10/ })).first().click();
        const popover = staff.getByRole("dialog", { name: /Sửa kích thước|Edit dimension/ });
        await expect(popover).toBeVisible();
        await popover.getByLabel(/Số mới|New value/).fill("7.20");
        await shots.take(
          staff,
          "popover",
          [
            popover.getByLabel(/Số cũ|Old value/),
            popover.getByLabel(/Số mới|New value/),
            new Right(popover.getByRole("button", { name: /^(Áp dụng|Apply)$/ })),
            popover.getByRole("button", { name: /Trả về số gốc|Revert to original/ }),
          ],
          Shots.clipAround((await popover.boundingBox())!),
        );
        await staff.keyboard.press("Escape");
        await expect(popover).toBeHidden();
      }
      {
        await button(staff, /^(Vẽ khung|Draw box)/).click();
        const v = PDF_VALUES.find((p) => p.value === "1.70")!;
        await dragBox(staff, v.cx - 0.022, v.cy - 0.009, v.cx + 0.022, v.cy + 0.009);
        const angle = staff.getByRole("dialog", { name: /Chiều của số|Direction of the value/ });
        await expect(angle).toBeVisible();
        await angle.getByLabel(/Xoay tự do|Free rotation/).click();
        await angle.getByLabel(/Góc \(độ\)|Angle \(degrees\)/).fill("0");
        await shots.take(
          staff,
          "draw-box",
          [
            angle.getByLabel(/Nằm ngang|Horizontal/),
            angle.getByLabel(/Góc \(độ\)|Angle \(degrees\)/),
            new Right(angle.getByRole("button", { name: /^(Tiếp tục|Continue)$/ })),
          ],
          Shots.clipAround((await angle.boundingBox())!),
        );
        await angle.getByRole("button", { name: /^(Huỷ|Cancel)$/ }).click();
        await expect(angle).toBeHidden();
      }
      {
        await openExportCheck(staff, "pdf");
        const dialog = staff.getByRole("dialog", { name: /Kiểm tra trước khi xuất|Check before exporting/ });
        await shots.take(
          staff,
          "export-check",
          [
            new Right(dialog.getByText(/^(Đã sửa|Edited) 6.90/)),
            dialog.getByText(/Bảng bên phải không đổi|The table on the right does not change/),
            new Right(dialog.getByRole("button", { name: /^(Xuất|Export) PDF$/ })),
            dialog.getByRole("button", { name: /Quay lại sửa|Back to editing/ }),
          ],
          Shots.clipAround((await dialog.boundingBox())!),
        );
        await dialog.getByRole("button", { name: /Quay lại sửa|Back to editing/ }).click();
      }

      // 4. the list, with a second sheet --------------------------------------------------------------------------
      {
        await uploadSheet(staff, "Pendant PD-2210.pdf", "application/pdf", await valuesPdf());
        await staff.goto("/sheets");
        const row = staff.getByRole("link", { name: "Ring RG-1042" }).or(staff.getByText("Ring RG-1042")).first();
        await expect(row).toBeVisible();
        await shots.take(staff, "list", [
          new Above(button(staff, /Tải phiếu lên|Upload sheet/).first()),
          staff.getByRole("searchbox", { name: /Tìm theo tên phiếu|Search sheet names/ }),
          new Right(staff.getByRole("tab", { name: /Thùng rác|Trash/ })),
          button(staff, /^(Thao tác với|Actions for) Ring RG-1042$/),
        ], { x: 100, y: 0, width: 1240, height: 420 });
      }

      // 5. Admin: users, then Trash -------------------------------------------------------------------------------
      {
        const page = await adminCtx.newPage();
        page.on("dialog", (d) => void d.accept());
        await page.goto("/admin/users", { timeout: 120_000 });
        const email = "e2e-staff@ctyhp.vn";
        await page.getByRole("searchbox", { name: /Tìm theo tên hoặc email|Search by name or email/ }).fill(email);
        const row = page.getByRole("row").filter({ hasText: email });
        await expect(row).toHaveCount(1);
        await page.mouse.click(1000, 700); // takes focus off the search box
        await shots.take(page, "admin-users", [
          new Above(button(page, /^(Tạo tài khoản|Create account)$/)),
          page.getByRole("searchbox", { name: /Tìm theo tên hoặc email|Search by name or email/ }),
          new Above(row.getByRole("button", { name: /^(Đặt làm quản trị viên|Make Admin): / })),
          new Above(row.getByRole("button", { name: /^(Đình chỉ|Suspend): / })),
          // In Vietnamese the buttons wrap and this one starts a new line: its left is free there.
          locale === "vi"
            ? row.getByRole("button", { name: /^Cấp lại mật khẩu: / })
            : new Above(row.getByRole("button", { name: /^Issue new password: / })),
        ], { x: 100, y: 0, width: 1240, height: 640 });

        // A sheet in the Trash, made by the reserved Admin and removed again below.
        await openSheet(page, "Bracelet BR-7731");
        await page.goto("/sheets");
        await button(page, /^(Thao tác với|Actions for) Bracelet BR-7731$/).click();
        await page.getByRole("menuitem", { name: /Đưa vào Thùng rác|Move to Trash/ }).click();
        await expect(page.getByText(/Đã chuyển|moved to the Trash/)).toBeVisible();
        await page.goto("/admin/trash");
        const trashRow = page.getByRole("row").filter({ hasText: "Bracelet BR-7731" });
        await expect(trashRow).toHaveCount(1);
        await shots.take(page, "admin-trash", [
          trashRow.getByRole("button", { name: /^(Xoá vĩnh viễn|Delete permanently)/ }),
          button(page, /^(Kiểm tra tệp mồ côi|Check for orphan files)$/),
        ], { x: 100, y: 0, width: 1240, height: 500 });
        await page.close();
      }

      await shots.save();
    } finally {
      // Every clean-up step runs; a step that fails is reported after all of them have run.
      const results = await Promise.allSettled([
        staffCtx.close(),
        adminCtx.close(),
        anonCtx.close(),
        staffId().then(deleteSheetsOf),
        adminId().then(deleteSheetsOf),
      ]);
      const failed = results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
      if (failed.length > 0) throw new AggregateError(failed, `clean-up failed (${failed.length} step(s)); sheets may be left behind`);
    }
  });
}

