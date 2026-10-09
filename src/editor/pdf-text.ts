import { exactDimension } from "@/lib/ocr/dimension-text";
import { normalizeAngle } from "@/lib/ocr/geometry";
import type { PageTextItem } from "@/lib/page/text";
import { centreInDrawingArea, toBox } from "./geometry";
import type { PxBox } from "./types";

/** Height of the digits as a share of the font size (Helvetica and Arial digits: 0.716 em). */
export const DIGIT_HEIGHT_EM = 0.72;
/** Two runs of the same value this close (share of the page width) are one value printed twice. */
const SAME_PLACE = 0.004;

/** Where the trimmed page sits inside the rendered page, and its size. */
export type Frame = { offsetX: number; offsetY: number; width: number; height: number };
export type TextValue = { value: string; px: PxBox };

const round2 = (n: number) => Math.round(n * 100) / 100 || 0;

/** Runs of one value are at most this far apart along the text, as a share of the digit height. */
const JOIN_GAP = 0.3;
/** ... and their baselines at most this far apart across it. */
const JOIN_BASELINE = 0.25;
/** ... and read at the same angle, give or take this many degrees. */
const JOIN_ANGLE = 1;
/** A value is never split into more runs than this ("2", ".", "50"). */
const MAX_PIECES = 4;

type Run = { item: PageTextItem; angle: number; h: number; s: number; t: number };

function runOf(item: PageTextItem): Run | null {
  const [a, b, c, d, e, f] = item.transform;
  const along = Math.hypot(a, b);
  const fontPx = Math.hypot(c, d);
  if (!(along > 0 && fontPx > 0 && item.width > 0)) return null;
  const u = { x: a / along, y: b / along };
  const up = { x: c / fontPx, y: d / fontPx };
  return { item, angle: normalizeAngle((Math.atan2(b, a) * 180) / Math.PI), h: DIGIT_HEIGHT_EM * fontPx, s: e * u.x + f * u.y, t: e * up.x + f * up.y };
}

/** Whether `next` carries on from `prev`: same angle, same baseline, and starts right where `prev` ends. */
function continues(prev: Run, next: Run): boolean {
  const turn = Math.abs(normalizeAngle(next.angle - prev.angle));
  if (turn > JOIN_ANGLE) return false;
  if (Math.abs(next.t - prev.t) > JOIN_BASELINE * prev.h) return false;
  return Math.abs(next.s - (prev.s + prev.item.width)) < JOIN_GAP * prev.h;
}

/**
 * The runs from `start` on that form one dimension together ("2." + "50"), as one run spanning them all, and
 * how many runs it took. Null when no such join exists; a run that is a dimension by itself is not joined.
 */
function joinFrom(runs: readonly (Run | null)[], start: number): { item: PageTextItem; used: number } | null {
  const first = runs[start];
  if (!first) return null;
  let text = first.item.str;
  let last = first;
  for (let j = start + 1; j < Math.min(runs.length, start + MAX_PIECES); j++) {
    const next = runs[j];
    if (!next || !continues(last, next)) return null;
    text += next.item.str;
    last = next;
    if (exactDimension(text) !== null) {
      return { item: { str: text, transform: first.item.transform, width: last.s + last.item.width - first.s }, used: j - start + 1 };
    }
  }
  return null;
}

/**
 * UC-04 step 2: number-shaped runs of the text layer inside the drawing area, with their box and angle in
 * pixels of the trimmed page. The box runs from the baseline to the digits' height along the advance.
 * A value that the PDF split across neighbouring runs is joined first (see `joinFrom`).
 */
export function pdfTextValues(items: readonly PageTextItem[], frame: Frame): TextValue[] {
  const runs = items.map(runOf);
  const out: TextValue[] = [];
  for (let i = 0; i < items.length; i++) {
    let item = items[i];
    let used = 1;
    if (exactDimension(item.str) === null) {
      const joined = joinFrom(runs, i);
      if (!joined) continue;
      item = joined.item;
      used = joined.used;
    }
    i += used - 1;
    const value = exactDimension(item.str);
    if (value === null) continue;
    const [a, b, c, d, e, f] = item.transform;
    const along = Math.hypot(a, b);
    const fontPx = Math.hypot(c, d);
    if (!(along > 0 && fontPx > 0 && item.width > 0)) continue;
    const u = { x: a / along, y: b / along };
    const up = { x: c / fontPx, y: d / fontPx };
    const h = DIGIT_HEIGHT_EM * fontPx;
    const cx = e + (item.width / 2) * u.x + (h / 2) * up.x - frame.offsetX;
    const cy = f + (item.width / 2) * u.y + (h / 2) * up.y - frame.offsetY;
    const px: PxBox = { cx, cy, w: item.width, h, angle: round2(normalizeAngle((Math.atan2(b, a) * 180) / Math.PI)) };
    if (!centreInDrawingArea(toBox(px, frame.width, frame.height))) continue;
    const twice = out.some((o) => o.value === value && Math.hypot(o.px.cx - cx, o.px.cy - cy) <= SAME_PLACE * frame.width);
    if (!twice) out.push({ value, px });
  }
  return out;
}
