import { describe, expect, it } from "vitest";
import { CLICK_SIDE_FRACTION, CLICK_SIZE, readAtPoint } from "@/lib/ocr/click";
import { orderClockwise, type Point, type Quad } from "@/lib/ocr/geometry";
import type { OcrModels, RegionReader } from "@/lib/ocr/pipeline";
import { createRaster, cropTurnsQuarter, type Raster } from "@/lib/ocr/raster";
import { scanArea } from "@/lib/ocr/scan";
import { fromScan, makeEdit, readingBox, toDetection } from "@/editor/detections";
import { axes, boxCorners, boxFromQuad, drawingAreaPx } from "@/editor/geometry";

/**
 * A value written at a free angle must be measured and re-drawn at that angle. Before this was fixed, the
 * scan and the click stored only a quarter turn (0 here), so the digits were measured across the slanted
 * ink and the new value came out upright and about three times too tall.
 */

const W = 1100; // a small page with the template's ratio keeps the tests fast
const H = 850;
const DIGIT_PX = 13;
const LENGTH = 60;
const GAP_TO_LINE = 4;
const CENTRE: Point = { x: 300, y: 300 }; // inside the drawing area
const models = {} as OcrModels;

/**
 * Four digit-like blocks along `angle` (12 px along the text, 13 px across, 3 px apart) and a dimension line,
 * 2 px thick, running parallel 4 px below the digits and on well beyond them.
 */
function sheetWithValueAt(angle: number): Raster {
  const r = createRaster(W, H);
  const { u, v } = axes(angle);
  for (let y = CENTRE.y - 200; y <= CENTRE.y + 200; y++) {
    for (let x = CENTRE.x - 200; x <= CENTRE.x + 200; x++) {
      const s = (x - CENTRE.x) * u.x + (y - CENTRE.y) * u.y;
      const t = (x - CENTRE.x) * v.x + (y - CENTRE.y) * v.y;
      const digit = Math.abs(s) < LENGTH / 2 && (s + LENGTH / 2) % 15 < 12 && Math.abs(t) < DIGIT_PX / 2;
      const line = Math.abs(s) < 150 && t >= DIGIT_PX / 2 + GAP_TO_LINE && t < DIGIT_PX / 2 + GAP_TO_LINE + 2;
      if (!digit && !line) continue;
      const i = (y * W + x) * 4;
      r.data[i] = 0x67;
      r.data[i + 1] = 0x66;
      r.data[i + 2] = 0x72;
    }
  }
  return r;
}

/** The quad a detector gives: the text's rectangle grown by 7 px on every side, in its corner order, on whole pixels. */
function detectorQuad(angle: number): Quad {
  const corners = boxCorners({ cx: CENTRE.x, cy: CENTRE.y, w: LENGTH + 14, h: DIGIT_PX + 14, angle });
  return orderClockwise(corners.map((p) => ({ x: Math.trunc(p.x), y: Math.trunc(p.y) })));
}

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const within = (got: number, want: number, eps: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(eps);
/** The digit height in whole page pixels: `fontPx` keeps 5 decimals of the page width (0.006 px here). */
const digitPx = (fontPx: number) => Math.round(fontPx * W);

describe("a value written at a free angle keeps that angle", () => {
  it.each([30, -45, 60])("a scan of a value at %i° stores that angle and measures 13-px digits", async (angle) => {
    const page = sheetWithValueAt(angle);
    const onPage = detectorQuad(angle);
    const area = drawingAreaPx(W, H);
    // The upright pass finds the value (the crop is wider than tall, read upright); the turned pass finds nothing.
    const read: RegionReader = async (_m, image) => {
      if (image.width !== area.w) return [];
      const quad = onPage.map((p) => ({ x: p.x - area.x, y: p.y - area.y })) as Quad;
      return [{ text: "1.20", score: 0.95, turn: cropTurnsQuarter(quad) ? 90 : 0, quad }];
    };
    const scan = await scanArea(models, page, area, area.w, read);
    const [d] = await fromScan(scan, page, ids());
    within(d.angle, angle, 1);
    const e = makeEdit(page, d, "1.20", "1.25");
    within(e.angle, angle, 1);
    within(digitPx(e.fontPx), DIGIT_PX, 1);

    // The control: measured upright, as the scan stored it before, the same value is far too tall.
    const upright = makeEdit(page, toDetection(page, boxFromQuad(onPage, 0), { readValue: "1.20", confidence: 95, source: "ocr" }, ids()), "1.20", "1.25");
    expect(upright.fontPx * W).toBeGreaterThan(2 * DIGIT_PX);
  });

  // 150°: a wide crop the reader reads upside down (turn 180). -105°: its quad is the one at 75°, a tall crop
  // the reader turns a quarter and still reads upside down (turn 270).
  it.each([
    [150, 180],
    [-105, 270],
  ] as const)("a scan of an upside-down value at %i° (read at turn %i) stores that angle and measures 13-px digits", async (angle, turn) => {
    const page = sheetWithValueAt(angle);
    const onPage = detectorQuad(angle);
    const area = drawingAreaPx(W, H);
    const read: RegionReader = async (_m, image) => {
      if (image.width !== area.w) return [];
      const quad = onPage.map((p) => ({ x: p.x - area.x, y: p.y - area.y })) as Quad;
      expect(cropTurnsQuarter(quad)).toBe(turn === 270);
      return [{ text: "1.20", score: 0.95, turn, quad }];
    };
    const scan = await scanArea(models, page, area, area.w, read);
    within(scan.detections[0].angle, angle, 1);
    const [d] = await fromScan(scan, page, ids());
    within(d.angle, angle, 1);
    const e = makeEdit(page, d, "1.20", "1.25");
    within(e.angle, angle, 1);
    within(digitPx(e.fontPx), DIGIT_PX, 1);
  });

  it.each([30, -45, 60])("a click on a value at %i° stores that angle and measures 13-px digits", async (angle) => {
    const page = sheetWithValueAt(angle);
    const onPage = detectorQuad(angle);
    // The click's square: side round(0.056 × W) around the click, scaled to 256 px; the upright angle reads the value.
    const side = Math.round(CLICK_SIDE_FRACTION * W);
    const origin = { x: Math.round(CENTRE.x - side / 2), y: Math.round(CENTRE.y - side / 2) };
    const scale = side / CLICK_SIZE;
    let calls = 0;
    const read: RegionReader = async () => {
      if (++calls > 1) return [];
      const quad = onPage.map((p) => ({ x: (p.x - origin.x) / scale, y: (p.y - origin.y) / scale })) as Quad;
      return [{ text: "1.20", score: 0.95, turn: cropTurnsQuarter(quad) ? 90 : 0, quad }];
    };
    const { reading } = await readAtPoint(models, page, CENTRE, 5000, read);
    expect(reading).not.toBeNull();
    within(reading!.angle, angle, 1);
    const d = toDetection(page, readingBox(page, reading!), { readValue: reading!.value, confidence: 95, source: "click" }, ids());
    within(d.angle, angle, 1);
    const e = makeEdit(page, d, "1.20", "1.25");
    within(e.angle, angle, 1);
    within(digitPx(e.fontPx), DIGIT_PX, 1);
  });
});
