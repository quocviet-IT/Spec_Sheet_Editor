import type { Raster } from "@/lib/ocr/raster";

/** US Letter landscape: 11 in ÷ 8.5 in, as written in the design (BR-01). */
export const TEMPLATE_RATIO = 1.294;
/** Pixels with luminance at or above this are paper when trimming borders (UC-03 step 4). */
export const NEAR_WHITE = 250;
export const MIB = 1024 * 1024;

/** The four CAD drawing panels, as fractions of the trimmed page (section 2.3). */
export const DRAWING_AREA = { x0: 0.046, x1: 0.67, y0: 0.133, y1: 0.746 } as const;

export type SourceType = "pdf" | "png" | "jpg";

export type FileCheck =
  | { ok: true; sourceType: SourceType }
  | { ok: false; reason: "wrong_type" }
  | { ok: false; reason: "too_large"; sizeMb: number };

const BY_EXTENSION: Record<string, SourceType> = { pdf: "pdf", png: "png", jpg: "jpg", jpeg: "jpg" };
const MIME: Record<SourceType, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" };

/** Non-standard type names some browsers and systems report for the same formats. */
const MIME_ALIASES: Record<string, SourceType> = { "image/jpg": "jpg", "application/x-pdf": "pdf" };

export function mimeOf(sourceType: SourceType): string {
  return MIME[sourceType];
}

/** Type by extension; a browser-reported type, when present, must agree. Then the size limit. */
export function checkFile(file: { name: string; size: number; type: string }, maxFileMb: number): FileCheck {
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const sourceType = BY_EXTENSION[ext];
  if (!sourceType) return { ok: false, reason: "wrong_type" };
  if (file.type !== "" && file.type !== MIME[sourceType] && MIME_ALIASES[file.type] !== sourceType) return { ok: false, reason: "wrong_type" };
  if (file.size > maxFileMb * MIB) return { ok: false, reason: "too_large", sizeMb: Math.ceil(file.size / MIB) };
  return { ok: true, sourceType };
}

/** The smallest rectangle holding every pixel darker than paper; the whole page if there is none. */
export function trimBounds(raster: Raster, threshold = NEAR_WHITE): { x: number; y: number; w: number; h: number } {
  const { width, height, data } = raster;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (299 * data[i] + 587 * data[i + 1] + 114 * data[i + 2]) / 1000;
      if (lum >= threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** The top of the tolerance setting's 0.5-5 % range; see `pageBox`. */
export const PAGE_CHOICE_TOLERANCE_PCT = 5;

/**
 * The white margins a workshop sheet keeps around its content, as fractions of the page. Measured on
 * two real sheets on 2026-10-10 (left 4.41 %, top 7.64 / 7.47 %, right 3.52 / 3.57 %, bottom 8.10 / 8.13 %).
 */
export const TEMPLATE_MARGINS = { left: 0.0441, top: 0.0756, right: 0.0354, bottom: 0.0812 } as const;

/** Width ÷ height of a sheet's content box (the page without its margins); about 1.413. */
export const CONTENT_RATIO =
  (TEMPLATE_RATIO * (1 - TEMPLATE_MARGINS.left - TEMPLATE_MARGINS.right)) / (1 - TEMPLATE_MARGINS.top - TEMPLATE_MARGINS.bottom);

const withinPct = (ratio: number, target: number, pct: number) => Math.abs(ratio / target - 1) <= pct / 100;

/**
 * The page rectangle inside a rendered image (it may reach outside the image). The content is whatever
 * ink `trimBounds` finds:
 * - if its ratio already matches the template within PAGE_CHOICE_TOLERANCE_PCT, the content is the page,
 *   so every sheet accepted before keeps exactly the same frame;
 * - else if its ratio matches a sheet's content box (CONTENT_RATIO) within the same tolerance, the page is
 *   rebuilt around it from TEMPLATE_MARGINS, because the sheet's own white margins belong to it. This also
 *   finds a sheet placed on a larger page, such as an A4 portrait PDF with white bands, or one cropped
 *   tightly to its content (the box then extends past the image);
 * - otherwise the whole image, which the ratio check then refuses.
 * The choice never depends on a setting an Admin can change: the editor recomputes the frame each time a
 * sheet opens, and stored detection coordinates are fractions of that frame.
 */
export function pageBox(raster: Raster): { x: number; y: number; w: number; h: number } {
  const b = trimBounds(raster);
  const ratio = b.w / b.h;
  if (withinPct(ratio, TEMPLATE_RATIO, PAGE_CHOICE_TOLERANCE_PCT)) return b;
  if (withinPct(ratio, CONTENT_RATIO, PAGE_CHOICE_TOLERANCE_PCT)) {
    const m = TEMPLATE_MARGINS;
    const w = b.w / (1 - m.left - m.right);
    const h = b.h / (1 - m.top - m.bottom);
    return { x: Math.round(b.x - m.left * w), y: Math.round(b.y - m.top * h), w: Math.round(w), h: Math.round(h) };
  }
  return { x: 0, y: 0, w: raster.width, h: raster.height };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * BR-01: width ÷ height within ± tolerance of 1.294, compared at 3 decimals (at 2 % the accepted
 * range is 1.268 – 1.320, as TC-14 states).
 */
export function ratioMatches(width: number, height: number, tolerancePct: number): boolean {
  if (!(width > 0 && height > 0)) return false;
  const lower = round3(TEMPLATE_RATIO * (1 - tolerancePct / 100));
  const upper = round3(TEMPLATE_RATIO * (1 + tolerancePct / 100));
  const ratio = round3(width / height);
  return ratio >= lower && ratio <= upper;
}
