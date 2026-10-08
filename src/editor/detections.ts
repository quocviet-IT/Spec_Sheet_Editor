import { DEFAULT_MODELS, type OcrClient } from "@/lib/ocr/client";
import type { Raster } from "@/lib/ocr/raster";
import type { ScanResult } from "@/lib/ocr/scan";
import type { PageTextItem } from "@/lib/page/text";
import { boxFromQuad, centreInDrawingArea, drawingAreaPx, roundAngle, roundBox, toBox, toPx } from "./geometry";
import { pdfTextValues } from "./pdf-text";
import { analyseBox } from "./pixels";
import type { Detection, Edit, PxBox } from "./types";

/** The trimmed page as the editor holds it, with the PDF text items of the rendered page. */
export type LoadedPage = { raster: Raster; text: readonly PageTextItem[]; offsetX: number; offsetY: number };
export type OcrLike = Pick<OcrClient, "init" | "setPage" | "scan">;
export type DetectResult =
  | { ok: true; source: "pdf-text" | "ocr"; detections: Detection[] }
  | { ok: false; reason: "ocr_load" | "ocr_scan" };

function stored(raster: Raster, px: PxBox, rest: Pick<Detection, "readValue" | "confidence" | "source">, newId: () => string): Detection {
  const tight = analyseBox(raster, px)?.tight ?? px;
  return { id: newId(), box: roundBox(toBox(tight, raster.width, raster.height)), angle: roundAngle(tight.angle), ...rest };
}

/** UC-04 step 2: values from the PDF text layer. */
export function fromPdfText(page: LoadedPage, newId: () => string): Detection[] {
  const { raster } = page;
  return pdfTextValues(page.text, { offsetX: page.offsetX, offsetY: page.offsetY, width: raster.width, height: raster.height })
    .map((v) => stored(raster, v.px, { readValue: v.value, confidence: null, source: "pdf-text" }, newId));
}

/** UC-04 steps 3–5: OCR readings inside the drawing area (BR-02), tightened to the digits. */
export function fromScan(scan: ScanResult, raster: Raster, newId: () => string): Detection[] {
  const out: Detection[] = [];
  for (const reading of scan.detections) {
    const px = boxFromQuad(reading.quad, reading.angle);
    if (!centreInDrawingArea(toBox(px, raster.width, raster.height))) continue;
    out.push(stored(raster, px, { readValue: reading.value, confidence: Math.round(reading.score * 100), source: "ocr" }, newId));
  }
  return out;
}

/** UC-04: the text layer when it has values in the drawing area, otherwise OCR on the drawing area. */
export async function detectValues(page: LoadedPage, startOcr: () => OcrLike, newId: () => string = () => crypto.randomUUID()): Promise<DetectResult> {
  const fromText = fromPdfText(page, newId);
  if (fromText.length > 0) return { ok: true, source: "pdf-text", detections: fromText };
  let ocr: OcrLike;
  try {
    ocr = startOcr();
    await ocr.init({ det: DEFAULT_MODELS.det, rec: DEFAULT_MODELS.rec, keys: DEFAULT_MODELS.keys });
  } catch {
    return { ok: false, reason: "ocr_load" };
  }
  try {
    await ocr.setPage(page.raster);
    const scan = await ocr.scan(drawingAreaPx(page.raster.width, page.raster.height));
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
