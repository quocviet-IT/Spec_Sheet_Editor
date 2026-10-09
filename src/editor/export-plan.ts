import { matchingValues } from "./matching";
import type { Detection, Edit } from "./types";

/** UC-09 step 5 / TC-46: "<sheet name>-edited.<ext>"; characters file systems refuse become "-". */
export function exportFileName(name: string, ext: "png" | "pdf"): string {
  const safe = name
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/ {2,}/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return `${safe.replace(/^[. ]+$/, "") || "sheet"}-edited.${ext}`;
}

/** Where the trimmed page sits in the original PDF page (in render pixels), or an image sheet. */
export type ExportSource =
  | { kind: "pdf"; pageWidthPt: number; pageHeightPt: number; pxPerPt: number; offsetX: number; offsetY: number }
  | { kind: "image" };

export const LETTER_LANDSCAPE = { width: 792, height: 612 } as const;

/** Page size and image placement in points, PDF coordinates (y counts up from the bottom). */
export type PdfLayout = { pageWidth: number; pageHeight: number; x: number; y: number; width: number; height: number };

/**
 * UC-09 step 4: a PDF sheet goes back on a page of the original size with the image where the trimmed
 * page sat (so any trimmed white border returns as page); an image sheet is fitted, centred and without
 * distortion, on US Letter landscape.
 */
export function pdfLayout(imageW: number, imageH: number, source: ExportSource): PdfLayout {
  if (source.kind === "pdf") {
    const width = imageW / source.pxPerPt;
    const height = imageH / source.pxPerPt;
    const x = source.offsetX / source.pxPerPt;
    const top = source.offsetY / source.pxPerPt;
    return { pageWidth: source.pageWidthPt, pageHeight: source.pageHeightPt, x, y: source.pageHeightPt - top - height, width, height };
  }
  const { width: pageWidth, height: pageHeight } = LETTER_LANDSCAPE;
  const scale = Math.min(pageWidth / imageW, pageHeight / imageH);
  const width = imageW * scale;
  const height = imageH * scale;
  return { pageWidth, pageHeight, x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}

export type Suggestion = { oldValue: string; newValue: string; ids: string[] };

/** UC-10 step 2 (BR-07): for each edited old value, the other places that still show it unedited. */
export function exportSuggestions(detections: readonly Detection[], edits: readonly Edit[]): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const e of edits) {
    if (seen.has(e.oldValue)) continue;
    seen.add(e.oldValue);
    const others = matchingValues(detections, edits, e.oldValue, e.detectionId);
    if (others.length > 0) out.push({ oldValue: e.oldValue, newValue: e.newValue, ids: others.map((d) => d.id) });
  }
  return out;
}
