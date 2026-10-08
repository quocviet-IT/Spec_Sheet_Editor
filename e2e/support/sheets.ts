import { expect, type Page } from "@playwright/test";
import { db } from "./db";
import { OUTSIDE_VALUES, PDF_VALUES, type PlacedValue } from "./files";

export type StoredBox = { cx: number; cy: number; w: number; h: number };
export type StoredDetection = { id: string; box: StoredBox; angle: number; readValue: string | null; confidence: number | null; source: string };
export type StoredEdit = { detectionId: string; oldValue: string; newValue: string; box: StoredBox; angle: number; fontPx: number; textColor: string; bgColor: string };

export const TOP_LEFT = /ô trên bên trái|top-left panel/;
export const TOP_RIGHT = /ô trên bên phải|top-right panel/;
export const BOTTOM_LEFT = /ô dưới bên trái|bottom-left panel/;
export const BOTTOM_RIGHT = /ô dưới bên phải|bottom-right panel/;

/** Uploads through the dialog and waits for the editor; the sheet is named after the file. */
export async function uploadSheet(page: Page, fileName: string, mimeType: string, buffer: Buffer): Promise<{ id: string; name: string }> {
  await page.goto("/sheets");
  await page.getByRole("button", { name: /Tải phiếu lên|Upload sheet/ }).first().click();
  const dialog = page.getByRole("dialog");
  await page.locator("#upload-file").setInputFiles({ name: fileName, mimeType, buffer });
  await dialog.getByRole("button", { name: /^(Tải lên|Upload)$/ }).click();
  await page.waitForURL(/\/sheets\/[0-9a-f-]{36}$/);
  return { id: page.url().split("/").pop()!, name: fileName.replace(/\.[^.]+$/, "") };
}

export async function storedSheet(id: string): Promise<{ version: number; detections: StoredDetection[]; edits: StoredEdit[]; deleted: boolean }> {
  const sql = db();
  try {
    const [row] = await sql<{ version: number; detections: StoredDetection[]; edits: StoredEdit[]; deleted_at: Date | null }[]>`
      select version, detections, edits, deleted_at from public.spec_sheets where id = ${id}`;
    if (!row) throw new Error(`sheet ${id} not found`);
    return { version: row.version, detections: row.detections, edits: row.edits, deleted: row.deleted_at !== null };
  } finally {
    await sql.end();
  }
}

export async function auditCount(id: string, action: string): Promise<number> {
  const sql = db();
  try {
    const rows = await sql`select 1 from public.audit_log where target_id = ${id} and action = ${action}`;
    return rows.length;
  } finally {
    await sql.end();
  }
}

export async function waitForVersion(id: string, version: number, timeout = 30_000): Promise<void> {
  // Wait for the version to reach the expected one, then require it to be exactly that: a skipped
  // version fails with a clear message instead of a timeout.
  await expect.poll(async () => (await storedSheet(id)).version >= version, { timeout, intervals: [500, 1000] }).toBe(true);
  expect((await storedSheet(id)).version, `sheet ${id} should be at version ${version}`).toBe(version);
}

/** Every value marker on the sheet (their labels start with "Số " / "Value "). */
export function markers(page: Page) {
  return page.getByRole("button", { name: /^(Số|Value) \d/ });
}

export function marker(page: Page, value: string, panel: RegExp) {
  return page.getByRole("button", { name: new RegExp(`^(Số|Value) ${value.replace(".", "\\.")}, (${panel.source})`) });
}

/** Expected values with no stored value of the same reading near the same place at the same angle. */
export function unmatchedValues(expected: readonly PlacedValue[], found: readonly StoredDetection[], tolerance: { position: number; angle: number }): PlacedValue[] {
  const left = [...found];
  return expected.filter((e) => {
    const i = left.findIndex(
      (d) =>
        d.readValue === e.value &&
        Math.abs(d.box.cx - e.cx) <= tolerance.position &&
        Math.abs(d.box.cy - e.cy) <= tolerance.position &&
        Math.abs(d.angle - e.angle) <= tolerance.angle,
    );
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
}

/** A 300-DPI PNG of the same values drawn by the browser (no text layer, so the editor uses OCR). */
export async function drawValuesPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate((values) => {
    const W = 3300;
    const H = 2550;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4); // a frame at the edges, so trimming keeps the whole page
    ctx.fillStyle = "#676672";
    ctx.font = "38px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const v of values) {
      ctx.save();
      ctx.translate(v.cx * W, v.cy * H);
      ctx.rotate((v.angle * Math.PI) / 180);
      ctx.fillText(v.value, 0, 0);
      ctx.restore();
    }
    return canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
  }, [...PDF_VALUES, ...OUTSIDE_VALUES]);
  return Buffer.from(base64, "base64");
}

/** Records every request for the OCR Worker or its models made by the page from now on. */
export function watchOcrRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/models/") || path.startsWith("/ocr/")) seen.push(path);
  });
  return seen;
}
