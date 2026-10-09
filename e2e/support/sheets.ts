import { expect, type Page } from "@playwright/test";
import { db } from "./db";
import { OUTSIDE_VALUES, PDF_VALUES, valuesPdf, type PlacedValue } from "./files";

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

export async function storedSheet(id: string): Promise<{ name: string; version: number; detections: StoredDetection[]; edits: StoredEdit[]; deleted: boolean }> {
  const sql = db();
  try {
    const [row] = await sql<{ name: string; version: number; detections: StoredDetection[]; edits: StoredEdit[]; deleted_at: Date | null }[]>`
      select name, version, detections, edits, deleted_at from public.spec_sheets where id = ${id}`;
    if (!row) throw new Error(`sheet ${id} not found`);
    return { name: row.name, version: row.version, detections: row.detections, edits: row.edits, deleted: row.deleted_at !== null };
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
export async function drawValuesPng(page: Page, values: readonly PlacedValue[] = [...PDF_VALUES, ...OUTSIDE_VALUES]): Promise<Buffer> {
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
  }, [...values]);
  return Buffer.from(base64, "base64");
}

/** A value drawn by the browser as a PNG: 38 px Arial in the sheet's ink on white, as at 300 DPI. */
export async function textPng(page: Page, text: string): Promise<{ png: Buffer; width: number; height: number }> {
  const out = await page.evaluate((t) => {
    const probe = document.createElement("canvas").getContext("2d")!;
    probe.font = "38px Arial";
    const width = Math.ceil(probe.measureText(t).width) + 16;
    const height = 38 + 16;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#676672";
    ctx.font = "38px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t, width / 2, height / 2);
    return { base64: canvas.toDataURL("image/png").slice("data:image/png;base64,".length), width, height };
  }, text);
  return { png: Buffer.from(out.base64, "base64"), width: out.width, height: out.height };
}

/** The viewport point for a page fraction, after scrolling the canvas into view. */
export async function canvasPoint(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const canvas = page.getByRole("img", { name: /^(Phiếu|Sheet) / });
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const point = { x: box.x + fx * box.width, y: box.y + fy * box.height };
  const view = page.viewportSize()!;
  expect(point.x >= 0 && point.x <= view.width && point.y >= 0 && point.y <= view.height, `point ${point.x},${point.y} should be inside the viewport`).toBe(true);
  return point;
}

/** Drags a box between two page fractions. */
export async function dragBox(page: Page, fx0: number, fy0: number, fx1: number, fy1: number): Promise<void> {
  const a = await canvasPoint(page, fx0, fy0);
  const b = await canvasPoint(page, fx1, fy1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/** A fresh synthetic sheet with its 11 values detected and stored (version 2). */
export async function openValuesSheet(page: Page, tag: string): Promise<{ id: string; name: string }> {
  const sheet = await uploadSheet(page, `${tag}-${Date.now()}.pdf`, "application/pdf", await valuesPdf());
  await expect(markers(page)).toHaveCount(11, { timeout: 30_000 });
  await waitForVersion(sheet.id, 2);
  return sheet;
}

export async function editValue(page: Page, value: string, panel: RegExp, next: string, confirmedOld?: string): Promise<void> {
  await marker(page, value, panel).click();
  const popover = page.getByRole("dialog", { name: /Sửa kích thước|Edit dimension/ });
  await expect(popover).toBeVisible();
  if (confirmedOld !== undefined) await popover.getByLabel(/Số cũ|Old value/).fill(confirmedOld);
  await popover.getByLabel(/Số mới|New value/).fill(next);
  await popover.getByLabel(/Số mới|New value/).press("Enter");
  await expect(popover).toBeHidden();
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

export type Point = { x: number; y: number };

/** Stores the canvas pixels on `window` for `canvasChanges`; returns the canvas size. */
export async function rememberCanvas(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[role='img']")!;
    const ctx = canvas.getContext("2d")!;
    (window as unknown as { __remembered: ImageData }).__remembered = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height };
  });
}

/** Pixels changed since `rememberCanvas`; with a polygon, how many lie inside and outside it; `angle` is the
 *  principal direction of the changed pixels (degrees, y down) from their second moments. */
export async function canvasChanges(page: Page, polygon?: Point[]): Promise<{ changed: number; inside: number; outside: number; angle: number | null }> {
  return page.evaluate((poly) => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[role='img']")!;
    const { width, height } = canvas;
    const before = (window as unknown as { __remembered: ImageData }).__remembered;
    const now = canvas.getContext("2d")!.getImageData(0, 0, width, height);
    const a = before.data;
    const b = now.data;
    const inPoly = (px: number, py: number) => {
      let inside = false;
      for (let i = 0, j = poly!.length - 1; i < poly!.length; j = i++) {
        const p = poly![i];
        const q = poly![j];
        if (p.y > py !== q.y > py && px < ((q.x - p.x) * (py - p.y)) / (q.y - p.y) + p.x) inside = !inside;
      }
      return inside;
    };
    let changed = 0, inside = 0, outside = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
        changed++;
        const px = x + 0.5;
        const py = y + 0.5;
        sx += px; sy += py; sxx += px * px; syy += py * py; sxy += px * py;
        if (poly) {
          if (inPoly(px, py)) inside++;
          else outside++;
        }
      }
    }
    let angle: number | null = null;
    if (changed >= 2) {
      const mx = sx / changed;
      const my = sy / changed;
      const vx = sxx / changed - mx * mx;
      const vy = syy / changed - my * my;
      const cxy = sxy / changed - mx * my;
      angle = (0.5 * Math.atan2(2 * cxy, vx - vy) * 180) / Math.PI;
    }
    return { changed, inside, outside, angle };
  }, polygon);
}

/** The edit's mask as the app draws it (digits box plus max(1, 0.15 x digit height), turned by the angle),
 *  grown by 1.5 px for anti-aliasing. */
export function maskPolygon(edit: StoredEdit, width: number, height: number): Point[] {
  void height;
  const pad = Math.max(1, 0.15 * edit.box.h * width);
  const hw = (edit.box.w * width + 2 * pad) / 2 + 1.5;
  const hh = (edit.box.h * width + 2 * pad) / 2 + 1.5;
  const rad = (edit.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = edit.box.cx * width;
  const cy = edit.box.cy * height;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
}
