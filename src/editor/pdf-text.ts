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

/**
 * UC-04 step 2: number-shaped runs of the text layer inside the drawing area, with their box and angle in
 * pixels of the trimmed page. The box runs from the baseline to the digits' height along the advance.
 */
export function pdfTextValues(items: readonly PageTextItem[], frame: Frame): TextValue[] {
  const out: TextValue[] = [];
  for (const item of items) {
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
