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
