import type { OcrClient } from "@/lib/ocr/client";
import { OcrFailure } from "@/lib/ocr/protocol";
import type { Raster } from "@/lib/ocr/raster";
import type { ScanResult } from "@/lib/ocr/scan";
import type { PageTextItem } from "@/lib/page/text";
import type { ExportSource } from "./export-plan";
import { boxFromQuad, centreInDrawingArea, drawingAreaPx, roundAngle, roundBox, toBox, toPx } from "./geometry";
import { pdfTextValues } from "./pdf-text";
import { analyseBox } from "./pixels";
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

/** UC-04 steps 3–5: OCR readings inside the drawing area (BR-02), tightened to the digits. */
export function fromScan(scan: ScanResult, raster: Raster, newId: () => string): Detection[] {
  const out: Detection[] = [];
  for (const reading of scan.detections) {
    const px = boxFromQuad(reading.quad, reading.angle);
    if (!centreInDrawingArea(toBox(px, raster.width, raster.height))) continue;
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
    return { ok: true, source: "ocr", detections: fromScan(scan, page.raster, newId) };
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
