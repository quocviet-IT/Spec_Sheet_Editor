import type { OcrClient } from "@/lib/ocr/client";
import { normalizeAngle, type Quad, type Rect } from "@/lib/ocr/geometry";
import { OcrFailure } from "@/lib/ocr/protocol";
import type { Raster } from "@/lib/ocr/raster";
import type { ScanResult } from "@/lib/ocr/scan";
import type { PageTextItem } from "@/lib/page/text";
import type { ExportSource } from "./export-plan";
import {
  boxForDrawnRect, boxFromQuad, centreInDrawingArea, drawingAreaPx, edgeMarginPx, isAxisAngle, nearestAxis, roundAngle, roundBox, snapAngle, toBox, toPx,
} from "./geometry";
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

/** The optional `prefix` field: present only when something is written in front of the value. */
function prefixField(prefix: string | undefined): { prefix?: string } {
  return prefix ? { prefix } : {};
}

type DetectionFields = Pick<Detection, "readValue" | "confidence" | "source" | "prefix">;

/** The box tightened to its ink, as stored. */
function storedBox(raster: Raster, px: PxBox): Pick<Detection, "box" | "angle"> {
  const tight = analyseBox(raster, px)?.tight ?? px;
  return { box: roundBox(toBox(tight, raster.width, raster.height)), angle: roundAngle(tight.angle) };
}

function stored(at: Pick<Detection, "box" | "angle">, rest: DetectionFields, newId: () => string): Detection {
  const { prefix, ...fields } = rest;
  return { id: newId(), ...at, ...fields, ...prefixField(prefix) };
}

/** A stored value at the box, tightened to its ink. A `prefix` of "" (the reader found none) is left out. */
export function toDetection(raster: Raster, px: PxBox, rest: DetectionFields, newId: () => string): Detection {
  return stored(storedBox(raster, px), rest, newId);
}

/**
 * BR-02 on what is stored: the value at the box, tightened to its ink (`toDetection`), or null when the
 * tightened box's centre lies outside the drawing area. Tightening keeps the strongest ink in the box, which
 * can be text of the table or the header beside the drawing, or a printed border the box is stretched to;
 * the text layer, the scan, a click and a drawn box all keep a value only through this check. No id is taken
 * for a value that is not kept.
 */
export function keptDetection(raster: Raster, px: PxBox, rest: DetectionFields, newId: () => string): Detection | null {
  const at = storedBox(raster, px);
  return centreInDrawingArea(at.box) ? stored(at, rest, newId) : null;
}

/** UC-04 step 2: values from the PDF text layer, kept only when centred inside the drawing area once tightened. */
export function fromPdfText(page: LoadedPage, newId: () => string): Detection[] {
  const { raster } = page;
  return pdfTextValues(page.text, { offsetX: page.offsetX, offsetY: page.offsetY, width: raster.width, height: raster.height }).flatMap((v) => {
    const d = keptDetection(raster, v.px, { readValue: v.value, confidence: null, source: "pdf-text" }, newId);
    return d ? [d] : [];
  });
}

type Reading = { quad: Quad; angle: number };

/**
 * A free angle within this many degrees of 0, 90, -90 or 180 is weighed against that axis
 * (`axisUnlessSlanted`): the detector's quad of a value written along an axis can lie this far off it.
 */
export const AXIS_SPAN = 15;
/**
 * Near an axis, the slanted angle is kept only when the digits measure at least this many pixels less tall
 * there than at the axis, and at least this share less tall.
 */
export const SLANT_MIN_GAIN_PX = 1;
export const SLANT_MIN_GAIN_SHARE = 0.08;

/**
 * The angle of a box whose free angle lies near an axis: the axis, unless the digits measure clearly less
 * tall at the slanted angle the search found (`found`, with `slanted` the search's tight box there) than at
 * the axis (SLANT_MIN_GAIN_PX and SLANT_MIN_GAIN_SHARE). Measured across slanted ink, digits come out too
 * tall, so a value written along the axis measures no less tall there; on a short value, or one a line
 * touches, the angle search sees no clear valley and keeps the quad's few degrees of noise. `boxAt` is the
 * box at another angle. A free angle farther than AXIS_SPAN from every axis, or a found angle that is an
 * axis, is kept as it is.
 */
function axisUnlessSlanted(raster: Raster, given: PxBox, slanted: PxBox, found: number, boxAt: (angle: number) => PxBox): number {
  const axis = nearestAxis(given.angle);
  if (isAxisAngle(found) || Math.abs(normalizeAngle(given.angle - axis)) > AXIS_SPAN) return found;
  const atAxis = analyseBox(raster, boxAt(axis))?.tight;
  // `refineAngle` gives the box itself back when it holds no text.
  const atSlant = slanted === given ? null : slanted;
  if (!atAxis || !atSlant) return atSlant ? found : axis;
  const clearlyLessTall = atSlant.h <= atAxis.h - SLANT_MIN_GAIN_PX && atSlant.h <= atAxis.h * (1 - SLANT_MIN_GAIN_SHARE);
  return clearlyLessTall ? found : axis;
}

/**
 * A reading's quad as a box at the reading's angle, made exactly 0, 90, -90 or 180 within SNAP_TOLERANCE.
 * A reading that close to an axis stays on it and its angle is not searched (by design): most values run
 * along the page's axes, and a quad a few degrees off one is the detector's noise, not a slant.
 */
function quadBox(reading: Reading): PxBox {
  return boxFromQuad(reading.quad, snapAngle(reading.angle));
}

/**
 * The quad's box turned to where the digits measure least tall, made exact again if that lands near an
 * axis; near an axis, the axis unless the value measures clearly less tall slanted (`axisUnlessSlanted`).
 */
function refinedQuadBox(raster: Raster, quad: Quad, px: PxBox): PxBox {
  if (isAxisAngle(px.angle)) return px;
  const refined = refineAngle(raster, px);
  const angle = axisUnlessSlanted(raster, px, refined, snapAngle(refined.angle), (a) => boxFromQuad(quad, a));
  return angle === px.angle ? px : boxFromQuad(quad, angle);
}

/**
 * A scan's or a click's reading as a box on the page, at the text's own angle. The reading's angle (its
 * quad's) becomes exactly 0, 90, -90 or 180 within SNAP_TOLERANCE (`quadBox`); a free angle is then turned
 * to where the digits measure least tall (`refineAngle`), made exact again if that lands near an axis, and
 * the box is the quad's at that angle. A quad within AXIS_SPAN of an axis gives the axis, unless the digits
 * measure clearly less tall at the slanted angle (`axisUnlessSlanted`).
 */
export function readingBox(raster: Raster, reading: Reading): PxBox {
  return refinedQuadBox(raster, reading.quad, quadBox(reading));
}

/**
 * UC-07: the box for a rectangle drawn around a value, at the angle the person chose. An axis choice stays
 * exact; a free angle is turned to where the digits measure least tall (`refineAngle`). A free angle typed
 * within AXIS_SPAN of an axis becomes that axis, unless the digits measure clearly less tall at the slanted
 * angle (`axisUnlessSlanted`). Unlike `readingBox`, a slanted result is not snapped to an axis: a free angle
 * the person typed near one (say 2°) around a value written at it stays a free angle near it.
 */
export function drawnBox(raster: Raster, rect: Rect, angle: number): PxBox {
  const px = boxForDrawnRect(rect, angle);
  if (isAxisAngle(px.angle)) return px;
  const refined = refineAngle(raster, px);
  const chosen = axisUnlessSlanted(raster, px, refined, refined.angle, (a) => boxForDrawnRect(rect, a));
  return chosen === px.angle ? px : boxForDrawnRect(rect, chosen);
}

/**
 * UC-07 steps 2–3: the new value for a rectangle drawn at `angle` (`drawnBox`), tightened to its digits.
 * "empty" when the rectangle holds no text (exception 3a); "outside" when the tightened value is centred
 * outside the drawing area (exception 3b, BR-02 via `keptDetection`): a rectangle centred inside may still
 * hold only text of the table or the header beside the drawing.
 */
export function drawnDetection(raster: Raster, rect: Rect, angle: number, newId: () => string): Detection | "empty" | "outside" {
  const px = drawnBox(raster, rect, angle);
  if (!analyseBox(raster, px)) return "empty";
  return keptDetection(raster, px, { readValue: null, confidence: null, source: "manual" }, newId) ?? "outside";
}

/** A new task, so the page can paint and answer input between two long measurements. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * UC-04 steps 3–5: OCR readings whose centre lies inside the drawing area (BR-02), tightened to the digits;
 * the scan also reads a margin beside the area, so a value at its edge is read whole. The area is first
 * checked on the quad's box, before the angle search, which costs several measurements per slanted value:
 * the box's centre is the quad's own at any angle (to within a pixel for whole-pixel corners). It is checked
 * again on the tightened box (`keptDetection`), which can move off the quad's centre. Before each slanted
 * value it waits for a new task, so a sheet full of them does not hold the page for seconds.
 */
export async function fromScan(scan: ScanResult, raster: Raster, newId: () => string): Promise<Detection[]> {
  const out: Detection[] = [];
  for (const reading of scan.detections) {
    const start = quadBox(reading);
    if (!centreInDrawingArea(toBox(start, raster.width, raster.height))) continue;
    if (!isAxisAngle(start.angle)) await nextTask();
    const px = refinedQuadBox(raster, reading.quad, start);
    const kept = keptDetection(raster, px, { readValue: reading.value, confidence: Math.round(reading.score * 100), source: "ocr", prefix: reading.prefix }, newId);
    if (kept) out.push(kept);
  }
  return out;
}

/**
 * UC-04: the text layer when it has values in the drawing area, otherwise a scan of the drawing area and
 * its margin (`edgeMarginPx`) by the page's reader (models loaded, page set). `isCancelled` stops before the
 * scan when the page closed while the reader was starting.
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
    const { width, height } = page.raster;
    const scan = await reader.scan(drawingAreaPx(width, height), { margin: edgeMarginPx(width) });
    return { ok: true, source: "ocr", detections: await fromScan(scan, page.raster, newId) };
  } catch {
    return { ok: false, reason: "ocr_scan" };
  }
}

/**
 * UC-05: the sign the machine read in front of a value, which the person may keep or drop when editing it
 * (a stray 0 or O read as Ø would turn a length into a diameter). `kept` is true unless an existing edit
 * dropped it. Null when there is no sign.
 */
export function signChoice(detection: Detection, edit: Edit | null): { sign: string; kept: boolean } | null {
  const sign = detection.prefix || edit?.prefix;
  if (!sign) return null;
  return { sign, kept: edit ? Boolean(edit.prefix) : true };
}

/**
 * UC-05 step 5: an edit of one value, measured on the original page (BR-03). The value's prefix comes
 * along, so it is drawn again in front of the new value, unless `keepPrefix` is false: then the edit has no
 * prefix, only the value is drawn, and the mask still erases the old sign.
 */
export function makeEdit(raster: Raster, detection: Detection, oldValue: string, newValue: string, keepPrefix = true): Edit {
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
    ...(keepPrefix ? prefixField(detection.prefix) : {}),
  };
}
