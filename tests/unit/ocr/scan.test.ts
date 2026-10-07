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
      if (image.width === 400) return [{ text: "16.30", score: 0.9, quad: square(40, 20, 10) } satisfies Reading];
      return [{ text: "2.50", score: 0.8, quad: square(20, 60, 10) }, { text: "SO", score: 0.99, quad: square(0, 0, 5) }];
    };
    const { detections } = await scanArea(models, page, area, 400, read);
    expect(detections).toHaveLength(2);
    const flat = detections.find((d) => d.value === "16.30")!;
    expect(flat.angle).toBe(0);
    expect(flat.box).toEqual({ x: 120, y: 60, w: 5, h: 5 });
    const upright = detections.find((d) => d.value === "2.50")!;
    expect(upright.angle).toBe(-90);
    // turned (20..30, 60..70) → upright (60..70, 169..179) → page (130..135, 134.5..139.5)
    expect(upright.box.x).toBeCloseTo(130, 6);
    expect(upright.box.y).toBeCloseTo(134.5, 6);
    expect(upright.box.w).toBeCloseTo(5, 6);
    expect(upright.box.h).toBeCloseTo(5, 6);
  });
});

describe("mergeOverlapping", () => {
  const det = (value: string, score: number, x: number): Detection => ({ value, text: value, score, angle: 0, box: { x, y: 0, w: 10, h: 5 } });

  it("keeps the more confident of two readings at one place", () => {
    expect(mergeOverlapping([det("2.59", 0.7, 0), det("2.50", 0.9, 4), det("1.70", 0.6, 100)], 20).map((d) => d.value)).toEqual(["2.50", "1.70"]);
  });
});
