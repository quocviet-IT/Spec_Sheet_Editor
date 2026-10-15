import { drawingAreaPx, edgeMarginPx } from "@/editor/geometry";
import { trimPage } from "@/lib/page/render";
import type { Point, Rect } from "../geometry";
import type { Raster } from "../raster";

/**
 * The 1135 × 877 sample sheet of the 2026-10-06 bake-off. The sheet itself stays outside the repository
 * (it carries order numbers); these are its 11 dimension values and their centres, read by eye
 * (research/ocr-bakeoff/prep.py), in the sample's own pixels.
 */
export const SAMPLE_SIZE = { width: 1135, height: 877 };

export type TruthValue = { key: string; value: string; x: number; y: number; orient: "horiz" | "vert" | "diag" };

export const SAMPLE_TRUTH: readonly TruthValue[] = [
  { key: "1.20", value: "1.20", x: 265, y: 134, orient: "diag" },
  { key: "2.50a", value: "2.50", x: 328, y: 189, orient: "vert" },
  { key: "6.90", value: "6.90", x: 147, y: 457, orient: "vert" },
  { key: "16.30", value: "16.30", x: 230, y: 536, orient: "horiz" },
  { key: "1.50", value: "1.50", x: 153, y: 605, orient: "vert" },
  { key: "1.70", value: "1.70", x: 296, y: 610, orient: "horiz" },
  { key: "1.80", value: "1.80", x: 538, y: 465, orient: "horiz" },
  { key: "10.29", value: "10.29", x: 650, y: 451, orient: "horiz" },
  { key: "7.05", value: "7.05", x: 703, y: 493, orient: "vert" },
  { key: "4.66", value: "4.66", x: 702, y: 575, orient: "vert" },
  { key: "2.50b", value: "2.50", x: 569, y: 627, orient: "horiz" },
];

/**
 * The sample as the editor holds it: trimmed to its page (`trimPage`), the frame the editor scans on that
 * page and the margin read around it (`drawingAreaPx` and `edgeMarginPx`, as `detectValues` asks for them),
 * and the truth moved onto the trimmed page. The click square and the merge window are fractions of the page
 * width, so the bench reads the trimmed page too.
 */
export type BenchView = { page: Raster; offset: Point; frame: Rect; margin: number; truth: TruthValue[] };

export function editorView(sample: Raster, truth: readonly TruthValue[] = SAMPLE_TRUTH): BenchView {
  const { raster: page, offsetX, offsetY } = trimPage({ raster: sample, pageCount: 1, text: [], pagePt: null });
  return {
    page,
    offset: { x: offsetX, y: offsetY },
    frame: drawingAreaPx(page.width, page.height),
    margin: edgeMarginPx(page.width),
    truth: truth.map((t) => ({ ...t, x: t.x - offsetX, y: t.y - offsetY })),
  };
}

/** The bake-off simulated an imprecise click 3 px right of and 2 px below each centre. */
export const CLICK_OFFSET = { x: 3, y: 2 };
/** A reading counts as found when its centre is within this many page pixels of the value's centre. */
export const NEAR_PX = 20;
/** TC-20 (the scan time; its located bar is set on the real sheets, not on this sample) and TC-24. */
export const TARGETS = { scanSeconds: 60, clickSeconds: 5 };
