import { describe, expect, it } from "vitest";
import type { Quad } from "@/lib/ocr/geometry";
import type { OcrModels, Reading, RegionReader } from "@/lib/ocr/pipeline";
import { createRaster } from "@/lib/ocr/raster";
import { mergeOverlapping, scanArea, type Detection } from "@/lib/ocr/scan";

const models = {} as OcrModels;
const square = (x: number, y: number, s: number): Quad => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe("scanArea", () => {
  it("maps readings from both orientations back to page pixels", async () => {
    const page = createRaster(400, 300);
    const area = { x: 100, y: 50, w: 200, h: 100 }; // scaled ×2 to 400 × 200
    const read: RegionReader = async (_models, image) => {
      // Upright image is 400 wide; the turned one is 200 wide.
      if (image.width === 400) return [{ text: "16.30", score: 0.9, turn: 0, quad: square(40, 20, 10) } satisfies Reading];
      return [
        { text: "2.50", score: 0.8, turn: 0, quad: square(20, 60, 10) },
        { text: "SO", score: 0.99, turn: 0, quad: square(0, 0, 5) },
      ];
    };
    const { detections } = await scanArea(models, page, area, 400, read);
    expect(detections).toHaveLength(2);
    const flat = detections.find((d) => d.value === "16.30")!;
    expect(flat.angle).toBe(0);
    expect(flat.box).toEqual({ x: 120, y: 60, w: 5, h: 5 });
    expect(flat.quad[0]).toEqual({ x: 120, y: 60 });
    const upright = detections.find((d) => d.value === "2.50")!;
    expect(upright.angle).toBe(-90);
    // turned (20..30, 60..70) → upright (60..70, 169..179) → page (130..135, 134.5..139.5)
    expect(upright.box.x).toBeCloseTo(130, 6);
    expect(upright.box.y).toBeCloseTo(134.5, 6);
    expect(upright.box.w).toBeCloseTo(5, 6);
    expect(upright.box.h).toBeCloseTo(5, 6);
  });

  it("adds the turns made while reading to the pass's angle", async () => {
    const read: RegionReader = async (_models, image) =>
      image.width === 400 ? [{ text: "16.30", score: 0.9, turn: 270, quad: square(40, 20, 10) }] : [];
    const { detections } = await scanArea(models, createRaster(400, 300), { x: 100, y: 50, w: 200, h: 100 }, 400, read);
    expect(detections[0].angle).toBe(-90);
  });

  it("enlarges by the whole number nearest the target width", async () => {
    const widths: number[] = [];
    const read: RegionReader = async (_models, image) => {
      widths.push(image.width);
      return [];
    };
    await scanArea(models, createRaster(400, 300), { x: 10, y: 10, w: 100, h: 50 }, 290, read);
    expect(widths).toEqual([300, 150]); // × 3: upright 300 × 150, then turned 150 × 300
    widths.length = 0;
    await scanArea(models, createRaster(400, 300), { x: 10, y: 10, w: 300, h: 50 }, 100, read);
    expect(widths).toEqual([300, 50]); // never shrinks: × 1
  });
});

describe("mergeOverlapping", () => {
  const det = (value: string, score: number, x: number): Detection => ({
    value,
    text: value,
    score,
    angle: 0,
    box: { x, y: 0, w: 10, h: 5 },
    quad: [{ x, y: 0 }, { x: x + 10, y: 0 }, { x: x + 10, y: 5 }, { x, y: 5 }],
  });

  it("keeps the more confident of two readings at one place", () => {
    expect(mergeOverlapping([det("2.59", 0.7, 0), det("2.50", 0.9, 4), det("1.70", 0.6, 100)], 20).map((d) => d.value)).toEqual(["2.50", "1.70"]);
  });
});
