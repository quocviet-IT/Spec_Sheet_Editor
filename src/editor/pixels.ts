import type { Raster } from "@/lib/ocr/raster";
import { axes } from "./geometry";
import type { PxBox } from "./types";

/** How far beyond the box to look, as a share of its height (at least 2 px). */
export const GROW = 0.25;
/** The ink floor is the luminance at this share of the box's pixels, sorted dark to light, so a few dark specks do not count. */
export const INK_FLOOR = 0.02;
/** The ink is the per-channel median of the pixels no lighter than this share of the way from the floor to the paper. */
export const INK_BAND = 0.25;
/** Below this luminance difference between paper and ink the box holds no text. */
export const MIN_CONTRAST = 40;
/** Fewer pixels clearly darker than paper than this inside the box: no text, only specks. */
export const MIN_INK_PIXELS = 8;
/** The ink floor also lies within the darkest tenth of the inky pixels themselves. */
export const INK_FLOOR_OF_INK = 0.1;

export type BoxAnalysis = { tight: PxBox; textColor: string; bgColor: string };

type Sample = { s: number; t: number; r: number; g: number; b: number; lum: number };
type Rgb = [number, number, number];

const luminance = (r: number, g: number, b: number) => (299 * r + 587 * g + 114 * b) / 1000;

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function medianColour(samples: readonly Sample[]): Rgb {
  return [median(samples.map((p) => p.r)), median(samples.map((p) => p.g)), median(samples.map((p) => p.b))];
}

export function hex(rgb: readonly [number, number, number]): string {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

/**
 * UC-04 step 5: the box tightened to the digits, with the ink and paper colours, or null when the box
 * holds no text. Pixels darker than halfway between paper and ink are text. Across the text, rows group
 * into runs separated by at least one empty row; the run holding the most dark pixels is the digits, so
 * a dimension line running under the value with a gap is left out. Along the text only the box's own
 * width is searched. A line touching the digits cannot be told apart and stays in the box.
 */
export function analyseBox(raster: Raster, box: PxBox): BoxAnalysis | null {
  const { width, height, data } = raster;
  const pad = Math.max(2, Math.round(box.h * GROW));
  const { u, v } = axes(box.angle);
  const halfW = box.w / 2;
  const halfH = box.h / 2;
  const outW = halfW + pad;
  const outH = halfH + pad;
  const ex = Math.abs(u.x) * outW + Math.abs(v.x) * outH;
  const ey = Math.abs(u.y) * outW + Math.abs(v.y) * outH;
  const x0 = Math.max(0, Math.floor(box.cx - ex));
  const x1 = Math.min(width - 1, Math.ceil(box.cx + ex));
  const y0 = Math.max(0, Math.floor(box.cy - ey));
  const y1 = Math.min(height - 1, Math.ceil(box.cy + ey));

  const region: Sample[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - box.cx;
      const dy = y - box.cy;
      const s = dx * u.x + dy * u.y;
      const t = dx * v.x + dy * v.y;
      if (Math.abs(s) > outW || Math.abs(t) > outH) continue;
      const i = (y * width + x) * 4;
      region.push({ s, t, r: data[i], g: data[i + 1], b: data[i + 2], lum: luminance(data[i], data[i + 1], data[i + 2]) });
    }
  }
  const inner = region.filter((p) => Math.abs(p.s) <= halfW && Math.abs(p.t) <= halfH);
  if (inner.length === 0) return null;

  const byLum = [...region].sort((a, b) => a.lum - b.lum);
  const paper = medianColour(byLum.slice(Math.floor(byLum.length / 2)));
  const innerByLum = [...inner].sort((a, b) => a.lum - b.lum);
  const paperLum = luminance(...paper);
  // Pixels clearly darker than paper; the floor is taken among them, so ink that covers less than
  // INK_FLOOR of a large drawn box still sets it (and a few specks alone are no text).
  const inky = innerByLum.findIndex((p) => p.lum >= paperLum - MIN_CONTRAST);
  const inkyCount = inky < 0 ? innerByLum.length : inky;
  if (inkyCount < MIN_INK_PIXELS) return null;
  const floorIndex = Math.min(Math.floor(innerByLum.length * INK_FLOOR), Math.floor(inkyCount * INK_FLOOR_OF_INK));
  const floorLum = innerByLum[floorIndex].lum;
  const limit = floorLum + INK_BAND * (paperLum - floorLum);
  const ink = medianColour(innerByLum.filter((p) => p.lum <= limit));
  const inkLum = luminance(...ink);
  if (paperLum - inkLum < MIN_CONTRAST) return null;
  const threshold = (paperLum + inkLum) / 2;

  const dark = region.filter((p) => p.lum < threshold && Math.abs(p.s) <= halfW);
  const rows = new Map<number, number>();
  for (const p of dark) {
    const k = Math.round(p.t);
    rows.set(k, (rows.get(k) ?? 0) + 1);
  }
  let best: { from: number; to: number; count: number } | null = null;
  let run: { from: number; to: number; count: number } | null = null;
  for (const k of [...rows.keys()].sort((a, b) => a - b)) {
    const n = rows.get(k)!;
    if (run && k === run.to + 1) {
      run.to = k;
      run.count += n;
    } else {
      run = { from: k, to: k, count: n };
    }
    if (!best || run.count > best.count) best = { ...run };
  }
  if (!best) return null;
  const { from, to } = best;

  let s0 = Infinity;
  let s1 = -Infinity;
  for (const p of dark) {
    const k = Math.round(p.t);
    if (k < from || k > to) continue;
    const s = Math.round(p.s);
    s0 = Math.min(s0, s);
    s1 = Math.max(s1, s);
  }
  const sm = (s0 + s1) / 2;
  const tm = (from + to) / 2;
  return {
    tight: { cx: box.cx + sm * u.x + tm * v.x, cy: box.cy + sm * u.y + tm * v.y, w: s1 - s0 + 1, h: to - from + 1, angle: box.angle },
    textColor: hex(ink),
    bgColor: hex(paper),
  };
}
