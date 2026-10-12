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

/** The ink colour: the median of the pixels no lighter than INK_BAND of the way from the floor to the paper. */
function inkColour(byLum: readonly Sample[], floorIndex: number, paperLum: number): Rgb {
  const floorLum = byLum[floorIndex].lum;
  const limit = floorLum + INK_BAND * (paperLum - floorLum);
  return medianColour(byLum.filter((p) => p.lum <= limit));
}

/**
 * Marks the dark pixels that belong to ink reaching the edge of the search window (8-connected): a line or
 * a drawing that runs on beyond the value, never a digit, which paper surrounds. `cells` maps the window's
 * bounding rectangle (`gw` wide) to region indices, -1 outside the window; the result is by region index.
 */
function inkReachingTheEdge(cells: Int32Array, gw: number, regionSize: number, isDark: (i: number) => boolean): Uint8Array {
  const gh = cells.length / gw;
  const reaches = new Uint8Array(regionSize);
  const seen = new Uint8Array(cells.length);
  const stack: number[] = [];
  const members: number[] = [];
  for (let start = 0; start < cells.length; start++) {
    if (seen[start] || cells[start] < 0 || !isDark(cells[start])) continue;
    seen[start] = 1;
    stack.push(start);
    members.length = 0;
    let atEdge = false;
    while (stack.length > 0) {
      const c = stack.pop()!;
      members.push(c);
      const cx = c % gw;
      const cy = (c - cx) / gw;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          const n = ny * gw + nx;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || cells[n] < 0) {
            atEdge = true;
            continue;
          }
          if (seen[n] || !isDark(cells[n])) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (atEdge) for (const m of members) reaches[cells[m]] = 1;
  }
  return reaches;
}

export function hex(rgb: readonly [number, number, number]): string {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

/**
 * UC-04 step 5: the box tightened to the digits, with the ink and paper colours, or null when the box
 * holds no text. Pixels darker than halfway between paper and ink are text. Across the text, rows group
 * into runs separated by at least one empty row; the run holding the most dark pixels is the digits, so
 * a dimension line running under the value with a gap is left out. Along the text only the box's own
 * width is searched. Ink that reaches the edge of the search window (a line crossing the value, a shank or
 * a stone of the drawing) is not counted in the runs, so it can neither stretch the digit height nor set
 * the text colour; the box therefore does not grow when it is measured again. A digit touching such ink
 * goes with it; when no other ink is left, all the dark pixels count. When the two biggest runs are less
 * than twice apart in dark pixels, the one whose centre is nearer the box centre wins.
 *
 * Half-pixel convention: a pixel (x, y) is sampled at the coordinates (x, y), so box coordinates are in
 * pixel-centre units: pixel i lies at i, and a box edge lies half a pixel beyond the outermost pixel
 * centre, on a pixel edge. The tight box therefore has an integer width and height (pixels counted, "+ 1")
 * and a centre that is a whole or half number. No further half-pixel shift is applied.
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
  const gw = Math.max(0, x1 - x0 + 1);
  const cells = new Int32Array(gw * Math.max(0, y1 - y0 + 1)).fill(-1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - box.cx;
      const dy = y - box.cy;
      const s = dx * u.x + dy * u.y;
      const t = dx * v.x + dy * v.y;
      if (Math.abs(s) > outW || Math.abs(t) > outH) continue;
      const i = (y * width + x) * 4;
      cells[(y - y0) * gw + (x - x0)] = region.length;
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
  const ink = inkColour(innerByLum, floorIndex, paperLum);
  const inkLum = luminance(...ink);
  if (paperLum - inkLum < MIN_CONTRAST) return null;
  const threshold = (paperLum + inkLum) / 2;

  // Ink that reaches the edge of the window (an extension line, a ring shank, a stone) would stretch the
  // digits' rows; only ink that paper surrounds is measured. A digit touching such ink goes with it, so
  // when nothing else is left, all the dark pixels are measured as before.
  const drawing = inkReachingTheEdge(cells, gw, region.length, (i) => region[i].lum < threshold);
  const dark = region.filter((p) => p.lum < threshold && Math.abs(p.s) <= halfW);
  const surrounded = region.filter((p, i) => !drawing[i] && p.lum < threshold && Math.abs(p.s) <= halfW);
  const digits = surrounded.length > 0 ? surrounded : dark;
  const rows = new Map<number, number>();
  for (const p of digits) {
    const k = Math.round(p.t);
    rows.set(k, (rows.get(k) ?? 0) + 1);
  }
  const runs: { from: number; to: number; count: number }[] = [];
  for (const k of [...rows.keys()].sort((x, y) => x - y)) {
    const n = rows.get(k)!;
    const last = runs[runs.length - 1];
    if (last && k === last.to + 1) {
      last.to = k;
      last.count += n;
    } else {
      runs.push({ from: k, to: k, count: n });
    }
  }
  if (runs.length === 0) return null;
  const [first, second] = [...runs].sort((x, y) => y.count - x.count);
  // The strongest run is the digits, unless a second run is nearly as strong (under 2x apart): then the
  // run nearer the middle of the box wins, since a box is drawn around the value, not around its edge.
  const centreOf = (r: { from: number; to: number }) => Math.abs((r.from + r.to) / 2);
  const best = second && first.count < 2 * second.count && centreOf(second) < centreOf(first) ? second : first;
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
  // The digits' own colour: drawing darker than the digits (a metal shank beside red text) must not set it.
  const ownByLum = digits === surrounded ? surrounded.filter((p) => Math.round(p.t) >= from && Math.round(p.t) <= to).sort((a, b) => a.lum - b.lum) : [];
  const textInk = ownByLum.length > 0 ? inkColour(ownByLum, Math.floor(ownByLum.length * INK_FLOOR_OF_INK), paperLum) : ink;
  return {
    tight: { cx: box.cx + sm * u.x + tm * v.x, cy: box.cy + sm * u.y + tm * v.y, w: s1 - s0 + 1, h: to - from + 1, angle: box.angle },
    textColor: hex(textInk),
    bgColor: hex(paper),
  };
}
