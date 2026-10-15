import { isPointedDimension, valueReadings } from "./dimension-text";
import { angleFromQuad, bounds, coveredShare, overlapShare, rectCentre, SAME_PLACE_OVERLAP, type Point, type Quad, type Rect } from "./geometry";
import { readRegion, type OcrModels, type Reading, type RegionReader } from "./pipeline";
import { crop, resizeBicubic, rotate90cw, rotateExpand, unrotatePoint, type Raster } from "./raster";

/**
 * A value found on the sheet. `prefix` is what is written in front of it ("Ø", "R", "2X Ø"; "" when none).
 * `box` (page pixels, axis-aligned) is for hit-testing; `quad` is the text's own box in page pixels; `angle`
 * is the text's angle, taken from its quad (design §6.3: -90 = vertical, read bottom-up; a slanted value
 * keeps its slant).
 */
export type Detection = { value: string; prefix: string; text: string; score: number; box: Rect; quad: Quad; angle: number };
export type ScanResult = { detections: Detection[]; timing: { horizontalMs: number; verticalMs: number; diagonalMs?: number } };

/**
 * UC-04 step 3: the drawing area is enlarged by the whole number that brings it closest to this width
 * (at least 1); a margin read around it is enlarged with it. A whole-number factor keeps every source pixel
 * on the grid: on the sample sheet, 708 px × 3 finds 1.50 where 708 → 2100 px does not.
 */
export const SCAN_TARGET_WIDTH = 2100;
/** Two readings of the same value closer than this (fraction of the page width) are one: 20 px on the 1135-px sample. */
export const MERGE_DISTANCE = 20 / 1135;
/**
 * Extra passes with the area turned these many degrees counter-clockwise, for values written on a slant. Off
 * (SCAN_DIAGONALS) until the browser bench shows the full scan of the sample still within TC-20's 60 s.
 */
export const DIAGONAL_TURNS = [45, -45] as const;
export const SCAN_DIAGONALS = false;

/**
 * A dropped reading's prefix goes to the kept reading of the same value when the kept quad holds at least
 * this much of the dropped one: the sign then lies inside the kept box, whose mask erases it on an edit, so
 * it must be drawn again. A sign outside the kept box stays on the page as it is.
 */
export const PREFIX_COVERED = 0.9;

/**
 * UC-04 step 4: where two readings are one value, keep the more confident one. They are one value when
 * they read the same value within `distance` of each other (page pixels, centre to centre on each axis),
 * or when their quads overlap by at least half of the smaller one. Different values close together are
 * both kept. When the dropped reading of the same value carried a prefix ("Ø1.30") and the kept one did
 * not ("1.30"), the kept one takes it if its quad holds the dropped one (`PREFIX_COVERED`).
 */
export function mergeOverlapping(candidates: readonly Detection[], distance: number): Detection[] {
  const kept: Detection[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const c = rectCentre(candidate.box);
    const clashes = (k: Detection) => {
      if (overlapShare(k.quad, candidate.quad) >= SAME_PLACE_OVERLAP) return true;
      if (k.value !== candidate.value) return false;
      const kc = rectCentre(k.box);
      return Math.abs(kc.x - c.x) <= distance && Math.abs(kc.y - c.y) <= distance;
    };
    if (!kept.some(clashes)) {
      kept.push(candidate);
      continue;
    }
    if (candidate.prefix === "") continue;
    const into = kept.findIndex(
      (k) => clashes(k) && k.value === candidate.value && k.prefix === "" && coveredShare(candidate.quad, k.quad) >= PREFIX_COVERED,
    );
    if (into >= 0) kept[into] = { ...kept[into], prefix: candidate.prefix };
  }
  return kept;
}

/** A text line read in the margin counts as inside the area within this many page pixels of its edge (whole-pixel edges). */
export const EDGE_SLACK_PX = 1;

/** The area grown by `margin` on each side; the growth stops at the page's edges. */
export function grownFrame(area: Rect, margin: number, pageW: number, pageH: number): Rect {
  if (!(margin > 0)) return area;
  const x = Math.min(area.x, Math.max(0, area.x - margin));
  const y = Math.min(area.y, Math.max(0, area.y - margin));
  const right = Math.max(area.x + area.w, Math.min(pageW, area.x + area.w + margin));
  const bottom = Math.max(area.y + area.h, Math.min(pageH, area.y + area.h + margin));
  return { x, y, w: right - x, h: bottom - y };
}

/** `scanArea`'s optional settings; each one left out takes its default. */
export type ScanOptions = {
  /** The width the area is enlarged towards (SCAN_TARGET_WIDTH). */
  targetWidth?: number;
  /** The text reader (`readRegion`); tests pass their own. */
  read?: RegionReader;
  /** Also read at ±45° (SCAN_DIAGONALS). */
  diagonals?: boolean;
  /** Page pixels read around the area on each side, within the page (0). */
  margin?: number;
};

/**
 * UC-04 steps 3–4: scan the drawing area at 0° and 90° clockwise (and ±45° with `diagonals`) and keep the
 * readings that are values. Every crop that is not a value with its point written is also read upside down,
 * and that reading replaces the upright one only when it is a value with its point written
 * (`upsideDownWins`); the kept reading's quad and turn give the angle. A value only repaired from 3–4 digits
 * is dropped where a value with its point written was read at the same place (`valueReadings`).
 *
 * `margin` (page pixels) grows the frame that is read on each side, within the page, so a value whose digits
 * run over the area's edge is read whole; the frame is enlarged by the area's own factor (SCAN_TARGET_WIDTH).
 * Only text lines whose centre lies inside the area (give or take a pixel) are then read: the margin holds
 * the text of the table and the boxes around the drawing, which no value of the drawing is (BR-02).
 */
export async function scanArea(models: OcrModels, page: Raster, area: Rect, options: ScanOptions = {}): Promise<ScanResult> {
  const { targetWidth = SCAN_TARGET_WIDTH, read = readRegion, diagonals = SCAN_DIAGONALS, margin = 0 } = options;
  const at = grownFrame(area, margin, page.width, page.height);
  const frame = crop(page, at);
  const factor = Math.max(1, Math.round(targetWidth / Math.max(1, Math.round(area.w))));
  const width = frame.width * factor;
  const height = frame.height * factor;
  const big = resizeBicubic(frame, width, height);
  const toPage = (p: Point): Point => ({ x: at.x + (p.x * frame.width) / width, y: at.y + (p.y * frame.height) / height });
  /** The reader's options for a pass whose image maps to the enlarged frame by `toBig`. */
  const optsFor = (toBig: (p: Point) => Point) => {
    if (at === area) return { bothDirections: true, accept: isPointedDimension };
    const keep = (quad: Quad) => {
      const c = toPage(toBig({ x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4, y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4 }));
      return c.x >= area.x - EDGE_SLACK_PX && c.x <= area.x + area.w + EDGE_SLACK_PX && c.y >= area.y - EDGE_SLACK_PX && c.y <= area.y + area.h + EDGE_SLACK_PX;
    };
    return { bothDirections: true, accept: isPointedDimension, keep };
  };

  /** Readings of one pass in page pixels, with the page angle of that pass's left-to-right. */
  type Pass = { readings: Reading[]; imageTurn: number; toBig: (p: Point) => Point };
  const passes: Pass[] = [];
  const upright = (p: Point) => p;
  const t0 = performance.now();
  passes.push({ readings: await read(models, big, optsFor(upright)), imageTurn: 0, toBig: upright });
  const t1 = performance.now();
  // A point (x, y) of the clockwise-turned image came from (y, height - 1 - x) of the upright one.
  const turned = (p: Point): Point => ({ x: p.y, y: height - 1 - p.x });
  passes.push({ readings: await read(models, rotate90cw(big), optsFor(turned)), imageTurn: -90, toBig: turned });
  const t2 = performance.now();
  if (diagonals) {
    for (const turn of DIAGONAL_TURNS) {
      const image = rotateExpand(big, turn);
      // Pixel centres sit at +0.5 in unrotatePoint's coordinates.
      const toBig = (p: Point): Point => {
        const c = unrotatePoint({ x: p.x + 0.5, y: p.y + 0.5 }, width, height, image.width, image.height, turn);
        return { x: c.x - 0.5, y: c.y - 0.5 };
      };
      passes.push({ readings: await read(models, image, optsFor(toBig)), imageTurn: turn, toBig });
    }
  }
  const t3 = performance.now();

  const onPage = passes.flatMap(({ readings, imageTurn, toBig }) =>
    readings.map((reading) => ({ ...reading, imageTurn, quad: reading.quad.map((p) => toPage(toBig(p))) as Quad, readQuad: reading.quad })),
  );
  const candidates: Detection[] = valueReadings(onPage).map(({ reading, dimension }) => ({
    value: dimension.value,
    prefix: dimension.prefix,
    text: reading.text,
    score: reading.score,
    // From the quad as read, before it is mapped to the page, so a quad along the axes gives exactly 0, ±90 or 180.
    angle: angleFromQuad(reading.readQuad, reading.turn, reading.imageTurn),
    box: bounds(reading.quad),
    quad: reading.quad,
  }));

  return {
    detections: mergeOverlapping(candidates, MERGE_DISTANCE * page.width),
    timing: { horizontalMs: t1 - t0, verticalMs: t2 - t1, ...(diagonals ? { diagonalMs: t3 - t2 } : {}) },
  };
}
