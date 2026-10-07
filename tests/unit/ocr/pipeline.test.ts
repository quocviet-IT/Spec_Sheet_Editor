import { describe, expect, it } from "vitest";
import { buildAlphabet } from "@/lib/ocr/alphabet";
import { fitWithinBounds, padVertically, readRegion, type OcrModels, type Tensor } from "@/lib/ocr/pipeline";
import { createRaster } from "@/lib/ocr/raster";

const chars = buildAlphabet("1\n6\n.\n3\n0\n");

/** A detector that sees one block in the middle of whatever it is given, and a recogniser that reads "16.30". */
function fakeModels(reads: { text: string; score: number }[] = []): OcrModels & { recCalls: number } {
  const spell = (text: string) => [...text].flatMap((ch) => [chars.indexOf(ch), 0]);
  const fake = {
    chars,
    recCalls: 0,
    async detect(input: Tensor): Promise<Tensor> {
      const [, , h, w] = input.dims;
      const data = new Float32Array(w * h);
      for (let y = Math.floor(h * 0.4); y < Math.floor(h * 0.6); y++) {
        for (let x = Math.floor(w * 0.3); x < Math.floor(w * 0.7); x++) data[y * w + x] = 0.9;
      }
      return { data, dims: [1, 1, h, w] };
    },
    async recognize(input: Tensor): Promise<Tensor> {
      const { text, score } = reads[fake.recCalls] ?? { text: "16.30", score: 0.9 };
      fake.recCalls++;
      const n = input.dims[0];
      const steps = spell(text);
      const data = new Float32Array(n * steps.length * chars.length);
      for (let b = 0; b < n; b++) steps.forEach((c, t) => (data[(b * steps.length + t) * chars.length + c] = c === 0 ? 0.9 : score));
      return { data, dims: [n, steps.length, chars.length] };
    },
  };
  return fake;
}

describe("fitWithinBounds", () => {
  it("shrinks the longer side to 2000 px in multiples of 32, like RapidOCR", () => {
    const out = fitWithinBounds(createRaster(2124, 1614));
    expect([out.raster.width, out.raster.height]).toEqual([1984, 1504]);
    expect(out.scaleX).toBeCloseTo(2124 / 1984, 9);
    expect(out.scaleY).toBeCloseTo(1614 / 1504, 9);
  });

  it("leaves a moderate image alone", () => {
    const img = createRaster(256, 256);
    expect(fitWithinBounds(img)).toEqual({ raster: img, scaleX: 1, scaleY: 1 });
  });
});

describe("padVertically", () => {
  it("adds black bands to a very wide image", () => {
    const out = padVertically(createRaster(400, 20));
    expect(out.top).toBe(40);
    expect([out.raster.width, out.raster.height]).toEqual([400, 100]);
    expect(out.raster.data[0]).toBe(0);
    expect(out.raster.data[(40 * 400) * 4]).toBe(255);
  });
});

describe("readRegion", () => {
  it("detects, crops and reads, with boxes in input pixels", async () => {
    const models = fakeModels();
    const readings = await readRegion(models, createRaster(64, 32));
    expect(readings).toHaveLength(1);
    expect(readings[0].text).toBe("16.30");
    expect(readings[0].score).toBeCloseTo(0.9, 6);
    for (const p of readings[0].quad) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(64);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(32);
    }
  });

  it("reads each crop twice when asked to try both directions", async () => {
    const models = fakeModels();
    await readRegion(models, createRaster(64, 32), { bothDirections: true });
    expect(models.recCalls).toBe(2);
  });

  it("maps boxes back through the resize and the black bands", async () => {
    // 400 × 20 → resized to 608 × 32 (shorter side ≥ 30) → 60-px bands above and below (608 / 32 > 8).
    const readings = await readRegion(fakeModels(), createRaster(400, 20));
    expect(readings).toHaveLength(1);
    const xs = readings[0].quad.map((p) => p.x);
    const ys = readings[0].quad.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    expect(Math.abs(cx - 200)).toBeLessThanOrEqual(3);
    expect(Math.abs(cy - 10)).toBeLessThanOrEqual(3);
  });

  it("keeps the upside-down reading when it is more confident", async () => {
    const readings = await readRegion(fakeModels([{ text: "16.30", score: 0.6 }, { text: "3.00", score: 0.95 }]), createRaster(64, 32), {
      bothDirections: true,
    });
    expect(readings[0].text).toBe("3.00");
    expect(readings[0].score).toBeCloseTo(0.95, 2);
  });
});
