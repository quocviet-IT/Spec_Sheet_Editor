import { toDimension } from "./dimension-text";
import { bounds, normalizeAngle, rectCentre, type Point, type Quad, type Rect } from "./geometry";
import { readRegion, type OcrModels, type RegionReader } from "./pipeline";
import { crop, resizeBicubic, rotateExpand, unrotatePoint, type Raster } from "./raster";

/** UC-06 step 2: the square around a click, as a fraction of the page width, scaled to 256 × 256. */
export const CLICK_SIDE_FRACTION = 0.056;
export const CLICK_SIZE = 256;
/** UC-06: upright first, then the two vertical turns, then the diagonals (degrees counter-clockwise). */
export const CLICK_ANGLES = [0, -90, 90, 60, -60] as const;
/** NFR-01 / TC-24. */
export const CLICK_DEADLINE_MS = 5000;

/**
 * `box` (page pixels, axis-aligned) is for hit-testing; `quad` is the text's own box in page pixels;
 * `angle` is the text's angle in the design's convention (§6.3).
 */
export type ClickReading = { value: string; text: string; score: number; angle: number; box: Rect; quad: Quad };
export type ReadResult = { reading: ClickReading | null; ms: number; anglesTried: number };

/**
 * UC-06: read the value around a click; stop at the first angle that yields a dimension, or at the
 * deadline. When several values are read, the one nearest the click wins; confidence breaks ties.
 */
export async function readAtPoint(
  models: OcrModels,
  page: Raster,
  point: Point,
  deadlineMs: number = CLICK_DEADLINE_MS,
  read: RegionReader = readRegion,
): Promise<ReadResult> {
  const started = performance.now();
  const side = Math.round(CLICK_SIDE_FRACTION * page.width);
  const origin = { x: Math.round(point.x - side / 2), y: Math.round(point.y - side / 2) };
  const square = resizeBicubic(crop(page, { ...origin, w: side, h: side }), CLICK_SIZE, CLICK_SIZE);
  const scale = side / CLICK_SIZE;

  let anglesTried = 0;
  let longestAngleMs = 0;
  for (const angle of CLICK_ANGLES) {
    // Do not start an angle that cannot finish before the deadline (TC-24).
    if (anglesTried > 0 && performance.now() - started + longestAngleMs > deadlineMs) break;
    anglesTried++;
    const angleStarted = performance.now();
    const image = angle === 0 ? square : rotateExpand(square, angle);
    const readings = await read(models, image, { bothDirections: true, accept: (text) => toDimension(text) !== null });
    longestAngleMs = Math.max(longestAngleMs, performance.now() - angleStarted);

    let best: ClickReading | null = null;
    let bestDistance = Infinity;
    for (const reading of readings) {
      const value = toDimension(reading.text);
      if (value === null) continue;
      // Back from the turned image to the 256-px square (pixel centres sit at +0.5 in unrotatePoint's
      // coordinates), then to the page.
      const corners = reading.quad.map((p) => {
        const c = angle === 0 ? p : unrotatePoint({ x: p.x + 0.5, y: p.y + 0.5 }, CLICK_SIZE, CLICK_SIZE, image.width, image.height, angle);
        const q = angle === 0 ? c : { x: c.x - 0.5, y: c.y - 0.5 };
        return { x: origin.x + q.x * scale, y: origin.y + q.y * scale };
      });
      const quad = corners as Quad;
      const box = bounds(quad);
      const centre = rectCentre(box);
      const d = Math.hypot(centre.x - point.x, centre.y - point.y);
      const nearer = d < bestDistance - 0.5;
      const asNear = Math.abs(d - bestDistance) <= 0.5;
      if (best === null || nearer || (asNear && reading.score > best.score)) {
        best = { value, text: reading.text, score: reading.score, angle: normalizeAngle(angle + reading.turn), box, quad };
        bestDistance = d;
      }
    }
    if (best !== null) return { reading: best, ms: performance.now() - started, anglesTried };
  }
  return { reading: null, ms: performance.now() - started, anglesTried };
}
