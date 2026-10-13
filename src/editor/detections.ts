import type { OcrClient } from "@/lib/ocr/client";
import type { Quad, Rect } from "@/lib/ocr/geometry";
import { OcrFailure } from "@/lib/ocr/protocol";
import type { Raster } from "@/lib/ocr/raster";
import type { ScanResult } from "@/lib/ocr/scan";
import type { PageTextItem } from "@/lib/page/text";
import type { ExportSource } from "./export-plan";
import { boxForDrawnRect, boxFromQuad, centreInDrawingArea, drawingAreaPx, isAxisAngle, roundAngle, roundBox, snapAngle, toBox, toPx } from "./geometry";
import { pdfTextValues } from "./pdf-text";
import { analyseBox, refineAngle } from "./pixels";
import type { Detection, Edit, PxBox } from "./types";

/** The trimmed page as the editor holds it, with the PDF text items of the rendered page. */
export type LoadedPage = { raster: Raster; text: readonly PageTextItem[]; offsetX: number; offsetY: number; source: ExportSource };
/** A READY reader: models loaded, page set. */
export type OcrLike = Pick<OcrClient, "scan">;
export type ReaderFailure = "ocr_load" | "ocr_unsupported";
export type DetectResult =
  | { ok: true; source: "pdf-text" | "ocr"; detections: Detection[] }
  | { ok: false; reason: ReaderFailure | "ocr_scan" | "cancelled" };

/** A download that failed is a connection problem; a runtime that cannot start is the browser's. */
export function ocrFailureReason(error: unknown): ReaderFailure {
  return error instanceof OcrFailure && error.code === "init_failed" ? "ocr_unsupported" : "ocr_load";
}

export function toDetection(raster: Raster, px: PxBox, rest: Pick<Detection, "readValue" | "confidence" | "source">, newId: () => string): Detection {
  const tight = analyseBox(raster, px)?.tight ?? px;
  return { id: newId(), box: roundBox(toBox(tight, raster.width, raster.height)), angle: roundAngle(tight.angle), ...rest };
}

/** UC-04 step 2: values from the PDF text layer. */
export function fromPdfText(page: LoadedPage, newId: () => string): Detection[] {
  const { raster } = page;
  return pdfTextValues(page.text, { offsetX: page.offsetX, offsetY: page.offsetY, width: raster.width, height: raster.height })
    .map((v) => toDetection(raster, v.px, { readValue: v.value, confidence: null, source: "pdf-text" }, newId));
}

type Reading = { quad: Quad; angle: number };

/**
 * A reading's quad as a box at the reading's angle, made exactly 0, 90, -90 or 180 within SNAP_TOLERANCE.
 * A reading that close to an axis stays on it and its angle is not searched (by design): most values run
 * along the page's axes, and a quad a few degrees off one is the detector's noise, not a slant.
 */
function quadBox(reading: Reading): PxBox {
  return boxFromQuad(reading.quad, snapAngle(reading.angle));
}

/** The quad's box turned to where the digits measure least tall, made exact again if that lands near an axis. */
function refinedQuadBox(raster: Raster, quad: Quad, px: PxBox): PxBox {
  const angle = snapAngle(refineAngle(raster, px).angle);
  return angle === px.angle ? px : boxFromQuad(quad, angle);
}

/**
 * A scan's or a click's reading as a box on the page, at the text's own angle. The reading's angle (its
 * quad's) becomes exactly 0, 90, -90 or 180 within SNAP_TOLERANCE (`quadBox`); a free angle is then turned
 * to where the digits measure least tall (`refineAngle`), made exact again if that lands near an axis, and
 * the box is the quad's at that angle.
 */
export function readingBox(raster: Raster, reading: Reading): PxBox {
  return refinedQuadBox(raster, reading.quad, quadBox(reading));
}

/**
 * UC-07: the box for a rectangle drawn around a value, at the angle the person chose. An axis choice stays
 * exact; a free angle is turned to where the digits measure least tall (`refineAngle`). Unlike
 * `readingBox`, the result is not snapped to an axis: a free angle the person typed near one (say 2°)
 * stays a free angle near it.
 */
export function drawnBox(raster: Raster, rect: Rect, angle: number): PxBox {
  const px = boxForDrawnRect(rect, angle);
  const refined = refineAngle(raster, px).angle;
  return refined === px.angle ? px : boxForDrawnRect(rect, refined);
}

/** A new task, so the page can paint and answer input between two long measurements. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * UC-04 steps 3–5: OCR readings inside the drawing area (BR-02), tightened to the digits. The area is
 * checked on the quad's box before the angle search, which costs several measurements per slanted value:
 * the box's centre is the quad's own at any angle (to within a pixel for whole-pixel corners). Before each
 * slanted value it waits for a new task, so a sheet full of them does not hold the page for seconds.
 */
export async function fromScan(scan: ScanResult, raster: Raster, newId: () => string): Promise<Detection[]> {
  const out: Detection[] = [];
  for (const reading of scan.detections) {
    const start = quadBox(reading);
    if (!centreInDrawingArea(toBox(start, raster.width, raster.height))) continue;
    if (!isAxisAngle(start.angle)) await nextTask();
    const px = refinedQuadBox(raster, reading.quad, start);
    out.push(toDetection(raster, px, { readValue: reading.value, confidence: Math.round(reading.score * 100), source: "ocr" }, newId));
  }
  return out;
}

/**
 * UC-04: the text layer when it has values in the drawing area, otherwise a scan of the drawing area by
 * the page's reader (models loaded, page set). `isCancelled` stops before the scan when the page closed
 * while the reader was starting.
 */
export async function detectValues(
  page: LoadedPage,
  getReader: () => Promise<OcrLike>,
  newId: () => string = () => crypto.randomUUID(),
  isCancelled: () => boolean = () => false,
): Promise<DetectResult> {
  const fromText = fromPdfText(page, newId);
  if (fromText.length > 0) return { ok: true, source: "pdf-text", detections: fromText };
  let reader: OcrLike;
  try {
    reader = await getReader();
  } catch (error) {
    return { ok: false, reason: ocrFailureReason(error) };
  }
  if (isCancelled()) return { ok: false, reason: "cancelled" };
  try {
    const scan = await reader.scan(drawingAreaPx(page.raster.width, page.raster.height));
    return { ok: true, source: "ocr", detections: await fromScan(scan, page.raster, newId) };
  } catch {
    return { ok: false, reason: "ocr_scan" };
  }
}

/** UC-05 step 5: an edit of one value, measured on the original page (BR-03). */
export function makeEdit(raster: Raster, detection: Detection, oldValue: string, newValue: string): Edit {
  const px = toPx(detection.box, detection.angle, raster.width, raster.height);
  const found = analyseBox(raster, px);
  const tight = found?.tight ?? px;
  const box = found ? roundBox(toBox(tight, raster.width, raster.height)) : detection.box;
  return {
    detectionId: detection.id,
    oldValue,
    newValue,
    box,
    angle: roundAngle(detection.angle),
    fontPx: Math.round((tight.h / raster.width) * 1e5) / 1e5,
    textColor: found?.textColor ?? "#000000",
    bgColor: found?.bgColor ?? "#ffffff",
  };
}
