import { toDimension } from "./dimension-text";
import { bounds, rectCentre, type Point, type Rect } from "./geometry";
import { readRegion, type OcrModels, type Reading, type RegionReader } from "./pipeline";
import { crop, resizeBilinear, rotate90cw, type Raster } from "./raster";

/** A value found on the sheet. `box` is in page pixels; `angle` follows the design (-90 = vertical, read bottom-up). */
export type Detection = { value: string; text: string; score: number; box: Rect; angle: 0 | -90 };
export type ScanResult = { detections: Detection[]; timing: { horizontalMs: number; verticalMs: number } };

/** UC-04 step 3: the drawing area is scaled to about this width before scanning. */
export const SCAN_TARGET_WIDTH = 2100;
/** Readings closer than this (fraction of the page width) are one value: 20 px on the 1135-px sample. */
export const MERGE_DISTANCE = 20 / 1135;

/** UC-04 step 4: where two readings sit at the same place, keep the more confident one. */
export function mergeOverlapping(candidates: readonly Detection[], distance: number): Detection[] {
  const kept: Detection[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const c = rectCentre(candidate.box);
    const clash = kept.some((k) => {
      const kc = rectCentre(k.box);
      return Math.abs(kc.x - c.x) <= distance && Math.abs(kc.y - c.y) <= distance;
    });
    if (!clash) kept.push(candidate);
  }
  return kept;
}

/** UC-04 steps 3–4: scan the drawing area at 0° and 90° clockwise and keep number-shaped readings. */
export async function scanArea(
  models: OcrModels,
  page: Raster,
  area: Rect,
  targetWidth: number = SCAN_TARGET_WIDTH,
  read: RegionReader = readRegion,
): Promise<ScanResult> {
  const frame = crop(page, area);
  const width = Math.round(targetWidth);
  const height = Math.round(frame.height * (width / frame.width));
  const big = resizeBilinear(frame, width, height);
  const toPage = (p: Point): Point => ({ x: area.x + (p.x * frame.width) / width, y: area.y + (p.y * frame.height) / height });

  const t0 = performance.now();
  const flat = await read(models, big);
  const t1 = performance.now();
  const turned = await read(models, rotate90cw(big));
  const t2 = performance.now();

  const candidates: Detection[] = [];
  const keep = (reading: Reading, angle: 0 | -90, toBig: (p: Point) => Point) => {
    const value = toDimension(reading.text);
    if (value === null) return;
    candidates.push({ value, text: reading.text, score: reading.score, angle, box: bounds(reading.quad.map((p) => toPage(toBig(p)))) });
  };
  flat.forEach((r) => keep(r, 0, (p) => p));
  // A point (x, y) of the clockwise-turned image came from (y, height - 1 - x) of the upright one.
  turned.forEach((r) => keep(r, -90, (p) => ({ x: p.y, y: height - 1 - p.x })));

  return {
    detections: mergeOverlapping(candidates, MERGE_DISTANCE * page.width),
    timing: { horizontalMs: t1 - t0, verticalMs: t2 - t1 },
  };
}
