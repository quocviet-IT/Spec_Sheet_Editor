import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { adminId, staffBId, staffId } from "./support/account";
import { admin, deleteSheetsOf } from "./support/db";
import { need } from "./support/env";
import { openValuesSheet } from "./support/sheets";

const VIEWPORT = { width: 1440, height: 900 };
const BUCKET = "feedback-screenshots";

type Report = {
  id: string;
  kind: string;
  status: string;
  page_route: string;
  screenshot_path: string | null;
  triage_note: string | null;
};

/** Removes the reports of every e2e account and their pictures: the pictures first, so no object is left without a row. */
async function cleanFeedback(): Promise<void> {
  const client = admin();
  const reporters = [await staffId(), await staffBId(), await adminId()];
  const { data, error } = await client.from("feedback_reports").select("id").in("reporter_id", reporters);
  if (error) throw new Error(`test reports not read: ${error.message}`);
  const bucket = client.storage.from(BUCKET);
  for (const { id } of data) {
    const listed = await bucket.list(id);
    if (listed.error) throw new Error(`test pictures not listed: ${listed.error.message}`);
    if (listed.data.length > 0) {
      const removed = await bucket.remove(listed.data.map((o) => `${id}/${o.name}`));
      if (removed.error) throw new Error(`test pictures not removed: ${removed.error.message}`);
    }
  }
  const deleted = await client.from("feedback_reports").delete().in("reporter_id", reporters);
  if (deleted.error) throw new Error(`test reports not deleted: ${deleted.error.message}`);
}

test.afterEach(async () => {
  await cleanFeedback();
  await deleteSheetsOf(await staffId());
});

/** A text no real report contains, so a row can be found among the reports of real people. */
function uniqueText(label: string): string {
  return `e2e ${label} ${randomUUID().slice(0, 8)}`;
}

async function reportByText(description: string): Promise<Report | null> {
  const { data, error } = await admin()
    .from("feedback_reports")
    .select("id, kind, status, page_route, screenshot_path, triage_note")
    .eq("description", description)
    .maybeSingle();
  if (error) throw new Error(`test report not read: ${error.message}`);
  return data;
}

/** A report filed for `reporterId` straight into the table, with a one-pixel picture when asked. */
async function seedReport(reporterId: string, description: string, withPicture: boolean): Promise<string> {
  const client = admin();
  const { data, error } = await client
    .from("feedback_reports")
    .insert({
      kind: "broken", impact: "minor", description, page_url: "/sheets", page_route: "/sheets", page_label: "Sheets", reporter_id: reporterId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`test report not inserted: ${error.message}`);
  if (withPicture) {
    const path = `${data.id}/${randomUUID()}.png`;
    const uploaded = await client.storage.from(BUCKET).upload(path, PNG.sync.write(new PNG({ width: 1, height: 1 })), { contentType: "image/png" });
    if (uploaded.error) throw new Error(`test picture not stored: ${uploaded.error.message}`);
    const attached = await client.from("feedback_reports").update({ screenshot_path: path }).eq("id", data.id);
    if (attached.error) throw new Error(`test picture not attached: ${attached.error.message}`);
  }
  return data.id;
}

function feedbackLink(page: Page): Locator {
  return page.getByRole("link", { name: /^(Feedback|Góp ý)(\s|$)/ });
}

const WAITING = /(\d+) (waiting|đang chờ)/;

test("TC-81 a report is filed with a screenshot from the editor", async ({ page }) => {
  await openValuesSheet(page, "fb");
  const description = uniqueText("misread");

  await page.getByRole("button", { name: /Report a problem or suggest an improvement|Báo lỗi hoặc góp ý cải tiến/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img", { name: /The screen as it was|Màn hình lúc gửi/ })).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel(/A value was read wrongly or missed|Máy đọc số sai hoặc bỏ sót/).check();
  await dialog.locator("#feedback-description").fill(description);
  await dialog.getByRole("button", { name: /^(Send|Gửi)$/ }).click();
  await expect(dialog.getByText(/^(Sent\.|Đã gửi\.)/)).toBeVisible({ timeout: 30_000 });

  await expect.poll(async () => (await reportByText(description))?.screenshot_path ?? null, { timeout: 30_000 }).not.toBeNull();
  const row = (await reportByText(description))!;
  expect(row.kind).toBe("misread");
  expect(row.status).toBe("new");
  expect(row.page_route).toBe("/sheets/[id]");
  const [folder, file] = row.screenshot_path!.split("/");
  expect(folder).toBe(row.id);
  const listed = await admin().storage.from(BUCKET).list(folder);
  expect(listed.error).toBeNull();
  expect(listed.data?.map((o) => o.name)).toContain(file);
});

test("TC-82 an Admin triages; declining needs a reason; the reporter sees the note and the count", async ({ browser, page }) => {
  const description = uniqueText("triage");
  const note = uniqueText("reason");
  await seedReport(await staffId(), description, true);

  const context = await browser.newContext({ storageState: "e2e/.auth/admin.json", viewport: VIEWPORT });
  try {
    const adminPage = await context.newPage();
    await adminPage.goto("/feedback?status=new");
    // At least one: the count may include real reports, so it is never compared with an exact number.
    await expect(feedbackLink(adminPage)).toHaveText(WAITING);
    const waiting = (await feedbackLink(adminPage).textContent())?.match(WAITING);
    expect(Number(waiting?.[1] ?? 0)).toBeGreaterThanOrEqual(1);

    const row = adminPage.getByRole("row").filter({ hasText: description });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("link", { name: /^(Screenshot|Ảnh chụp)$/ })).toBeVisible();

    const status = row.getByRole("combobox", { name: /^(Status|Trạng thái)$/ });
    await status.selectOption("declined");
    await expect(row.getByRole("alert")).toHaveText(/Write the reason for the reporter first|Ghi lý do cho người gửi trước đã/);
    await expect(status).toHaveValue("new");
    expect((await reportByText(description))?.status).toBe("new");

    await row.getByRole("textbox", { name: /A note for the reporter|Phản hồi cho người gửi/ }).fill(note);
    await status.selectOption("declined");
    await expect.poll(async () => (await reportByText(description))?.status, { timeout: 30_000 }).toBe("declined");
    expect((await reportByText(description))?.triage_note).toBe(note);
  } finally {
    await context.close();
  }

  // The reporter: the link counts the moved report, the page shows the note and the badge, and a visit clears the count.
  await page.goto("/sheets");
  await expect(feedbackLink(page)).toHaveText(/1 (waiting|đang chờ)/);
  await feedbackLink(page).click();
  await page.waitForURL("**/feedback");
  const mine = page.getByRole("row").filter({ hasText: description });
  await expect(mine).toContainText(note);
  await expect(mine).toContainText(/Updated|Mới cập nhật/);
  await expect(async () => {
    await page.reload();
    await expect(feedbackLink(page)).not.toHaveText(WAITING, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
});

/** The access token in the page's sign-in cookie (the cookie holds the session as base64url JSON, in chunks when long). */
async function accessTokenOf(page: Page): Promise<string> {
  const cookies = (await page.context().cookies()).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name));
  expect(cookies.length).toBeGreaterThan(0);
  const raw = cookies
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
    .map((c) => c.value)
    .join("");
  const json = Buffer.from(raw.replace(/^base64-/, ""), "base64url").toString("utf8");
  return (JSON.parse(json) as { access_token: string }).access_token;
}

/** A direct read of the table with the page's own session: the publishable key and the person's token, never the service role. */
async function readRowsThroughApi(page: Page, id: string): Promise<{ id: string }[]> {
  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const res = await page.request.get(`${url}/rest/v1/feedback_reports?select=id&id=eq.${id}`, {
    headers: {
      apikey: need("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      authorization: `Bearer ${await accessTokenOf(page)}`,
    },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as { id: string }[];
}

test("TC-83 another staff member cannot see the report", async ({ browser, page }) => {
  const description = uniqueText("private");
  const id = await seedReport(await staffId(), description, false);

  // Control: the reporter's own session does read the row, so an empty answer below means the rule, not a broken request.
  await page.goto("/feedback");
  await expect(page.getByText(description)).toBeVisible();
  expect(await readRowsThroughApi(page, id)).toHaveLength(1);

  const context = await browser.newContext({ storageState: "e2e/.auth/staff-b.json", viewport: VIEWPORT });
  try {
    const other = await context.newPage();
    await other.goto("/feedback");
    await expect(other.getByRole("heading", { name: /^(Feedback|Góp ý)$/ })).toBeVisible();
    await expect(other.getByText(description)).toHaveCount(0);
    expect(await readRowsThroughApi(other, id)).toEqual([]);
  } finally {
    await context.close();
  }
});
