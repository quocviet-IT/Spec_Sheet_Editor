import { describe, expect, it } from "vitest";
import { orderClockwise, type Quad } from "@/lib/ocr/geometry";
import type { OcrModels, Reading, RegionReader } from "@/lib/ocr/pipeline";
import { isPointedDimension } from "@/lib/ocr/dimension-text";
import { createRaster, rotateExpand } from "@/lib/ocr/raster";
import { DIAGONAL_TURNS, MERGE_DISTANCE, mergeOverlapping, PREFIX_COVERED, SCAN_DIAGONALS, scanArea, type Detection } from "@/lib/ocr/scan";
import { fakeModels, type FakeBlock } from "./fake-models";

const models = {} as OcrModels;
const square = (x: number, y: number, s: number): Quad => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];
/** A w × h text box turned `degrees` (y down) around (cx, cy), in the detector's corner order. */
const turnedBox = (cx: number, cy: number, w: number, h: number, degrees: number): Quad => {
  const a = (degrees * Math.PI) / 180;
  const at = (s: number, t: number) => ({ x: cx + s * Math.cos(a) - t * Math.sin(a), y: cy + s * Math.sin(a) + t * Math.cos(a) });
  return orderClockwise([at(-w / 2, -h / 2), at(w / 2, -h / 2), at(w / 2, h / 2), at(-w / 2, h / 2)]);
};

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

  it("keeps a slanted value's own angle, from its quad, in either pass", async () => {
    // At 30° in the upright image; at 20° in the clockwise-turned image, which is 20 - 90 = -70° on the page.
    const read: RegionReader = async (_models, image) =>
      image.width === 400
        ? [{ text: "16.30", score: 0.9, turn: 0, quad: turnedBox(100, 60, 40, 12, 30) }]
        : [{ text: "2.50", score: 0.8, turn: 0, quad: turnedBox(100, 200, 40, 12, 20) }];
    const { detections } = await scanArea(models, createRaster(400, 300), { x: 100, y: 50, w: 200, h: 100 }, 400, read);
    expect(detections.find((d) => d.value === "16.30")!.angle).toBeCloseTo(30, 6);
    expect(detections.find((d) => d.value === "2.50")!.angle).toBeCloseTo(-70, 6);
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

  it("keeps what is written in front of a value", async () => {
    const read: RegionReader = async (_models, image) =>
      image.width === 400
        ? [
            { text: "2X 01.10", score: 0.9, turn: 0, quad: square(40, 20, 10) },
            { text: "1.70", score: 0.9, turn: 0, quad: square(200, 20, 10) },
          ]
        : [];
    const { detections } = await scanArea(models, createRaster(400, 300), { x: 100, y: 50, w: 200, h: 100 }, 400, read);
    expect(detections.map((d) => [d.prefix, d.value])).toEqual([
      ["2X Ø", "1.10"],
      ["", "1.70"],
    ]);
  });

  it("asks each pass to re-read upside down every crop that is not a value with its point written", async () => {
    const seen: { both?: boolean; accept?: (text: string) => boolean }[] = [];
    const read: RegionReader = async (_models, _image, opts) => {
      seen.push({ both: opts?.bothDirections, accept: opts?.accept });
      return [];
    };
    await scanArea(models, createRaster(400, 300), { x: 100, y: 50, w: 200, h: 100 }, 400, read);
    expect(seen).toHaveLength(2);
    for (const { both, accept } of seen) {
      expect(both).toBe(true);
      expect(accept).toBe(isPointedDimension);
    }
  });

  it("sets the angle from the quad and turn of the reading the reader kept, upside down too", async () => {
    // The reader kept the upside-down reading of a wide crop (turn 180): the text runs right to left on the page.
    const read: RegionReader = async (_models, image) =>
      image.width === 400 ? [{ text: "6.90", score: 0.8, turn: 180, quad: square(40, 20, 10) }] : [];
    const { detections } = await scanArea(models, createRaster(400, 300), { x: 100, y: 50, w: 200, h: 100 }, 400, read);
    expect(detections.map((d) => [d.value, d.angle])).toEqual([["6.90", 180]]);
  });

  describe("through the real reader: the upside-down reading wins only with its point written", () => {
    const page = createRaster(400, 300);
    const area = { x: 100, y: 50, w: 200, h: 100 }; // × 2: the upright pass is 400 × 200, the turned one 200 × 400
    /** The detector sees the value only in the upright pass; the recogniser reads it upright, then upside down. */
    const scan = async (reads: { text: string; score: number }[], block?: FakeBlock) =>
      (await scanArea(fakeModels(reads, { block, sees: (w, h) => w > h }), page, area, 400)).detections.map((d) => [d.value, d.angle]);

    it("keeps the upright reading when neither has its point written, however confident the other", async () => {
      expect(await scan([{ text: "690", score: 0.9 }, { text: "069", score: 0.95 }])).toEqual([["6.90", 0]]);
      expect(await scan([{ text: "180", score: 0.88 }, { text: "081", score: 0.9 }])).toEqual([["1.80", 0]]);
      expect(await scan([{ text: "080", score: 0.8 }, { text: "080", score: 0.8 }])).toEqual([["0.80", 0]]);
    });

    it("keeps an upright value when the upside-down reading is not one", async () => {
      expect(await scan([{ text: "170", score: 0.8 }, { text: "0L1", score: 0.85 }])).toEqual([["1.70", 0]]);
    });

    it("takes the upside-down value with its point written over upright digits, at the upside-down angle", async () => {
      expect(await scan([{ text: "069", score: 0.95 }, { text: "6.90", score: 0.7 }])).toEqual([["6.90", 180]]);
    });

    it("gives a slanted value read upside down its own angle", async () => {
      // The block runs at -30° in the image; read upside down, the text runs the other way: 150°.
      const [[value, angle]] = await scan([{ text: "069", score: 0.95 }, { text: "6.90", score: 0.7 }], { cx: 0.5, cy: 0.5, w: 0.5, h: 0.1, degrees: -30 });
      expect(value).toBe("6.90");
      expect(Math.abs((angle as number) - 150)).toBeLessThan(2);
    });
  });

  it("rejects a value only repaired from digits where a value with its point written was read at the same place", async () => {
    // The upright pass reads the vertical value's tall crop upside down as "069" (the more confident reading);
    // the turned pass reads "6.90" at the same place: upright (60..70, 20..60) is turned (140..180, 60..70).
    const read: RegionReader = async (_models, image) =>
      image.width === 400
        ? [{ text: "069", score: 0.97, turn: 270, quad: [{ x: 60, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 60 }, { x: 60, y: 60 }] }]
        : [{ text: "6.90", score: 0.8, turn: 0, quad: [{ x: 140, y: 60 }, { x: 180, y: 60 }, { x: 180, y: 70 }, { x: 140, y: 70 }] }];
    const { detections } = await scanArea(models, createRaster(400, 300), { x: 100, y: 50, w: 200, h: 100 }, 400, read);
    expect(detections.map((d) => d.value)).toEqual(["6.90"]);
  });

  it("still repairs a value whose point was lost when no reading with its point covers the place", async () => {
    const read: RegionReader = async (_models, image) =>
      image.width === 400 ? [{ text: "170", score: 0.9, turn: 0, quad: square(40, 20, 10) }] : [];
    const { detections } = await scanArea(models, createRaster(400, 300), { x: 100, y: 50, w: 200, h: 100 }, 400, read);
    expect(detections.map((d) => d.value)).toEqual(["1.70"]);
  });

  it("leaves the passes turned ±45° off by default", async () => {
    expect(SCAN_DIAGONALS).toBe(false);
    const sizes: [number, number][] = [];
    const read: RegionReader = async (_models, image) => {
      sizes.push([image.width, image.height]);
      return [];
    };
    const result = await scanArea(models, createRaster(400, 300), { x: 100, y: 50, w: 200, h: 100 }, 400, read);
    expect(sizes).toEqual([[400, 200], [200, 400]]);
    expect(result.timing.diagonalMs).toBeUndefined();
  });

  it("when switched on, also reads the area turned ±45° and maps those readings back to the page", async () => {
    expect([...DIAGONAL_TURNS]).toEqual([45, -45]);
    const turned45 = rotateExpand(createRaster(400, 200), 45);
    const sizes: [number, number][] = [];
    // A value at the centre of the image turned 45°, written along its rows: on the page it runs at 45°.
    const read: RegionReader = async (_models, image) => {
      sizes.push([image.width, image.height]);
      // Pixel (x, y) has its centre at (x, y), so the image's centre is ((w - 1) / 2, (h - 1) / 2).
      const centre = { x: (image.width - 1) / 2, y: (image.height - 1) / 2 };
      return sizes.length === 3 ? [{ text: "1.20", score: 0.9, turn: 0, quad: turnedBox(centre.x, centre.y, 40, 12, 0) }] : [];
    };
    const { detections, timing } = await scanArea(models, createRaster(400, 300), { x: 100, y: 50, w: 200, h: 100 }, 400, read, true);
    expect(sizes).toEqual([[400, 200], [200, 400], [turned45.width, turned45.height], [turned45.width, turned45.height]]);
    expect(timing.diagonalMs).toBeGreaterThanOrEqual(0);
    expect(detections).toHaveLength(1);
    expect(detections[0].angle).toBeCloseTo(45, 6);
    // The turned image's centre is the enlarged area's centre (199.5, 99.5), which is (100 + 199.5 / 2, 50 + 99.5 / 2) on the page.
    const c = { x: detections[0].box.x + detections[0].box.w / 2, y: detections[0].box.y + detections[0].box.h / 2 };
    expect(c.x).toBeCloseTo(199.75, 6);
    expect(c.y).toBeCloseTo(99.75, 6);
  });
});

describe("mergeOverlapping", () => {
  const det = (value: string, score: number, x: number, y = 0, w = 10, h = 5): Detection => ({
    value,
    prefix: "",
    text: value,
    score,
    angle: 0,
    box: { x, y, w, h },
    quad: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
  });
  /** The old window on a 3300-px page: 20 px of the 1135-px sample, about 58 px. */
  const WINDOW = MERGE_DISTANCE * 3300;

  it("keeps the more confident of two readings at one place", () => {
    expect(mergeOverlapping([det("2.59", 0.7, 0), det("2.50", 0.9, 4), det("1.70", 0.6, 100)], 20).map((d) => d.value)).toEqual(["2.50", "1.70"]);
  });

  it("keeps two different values 40 px apart", () => {
    const merged = mergeOverlapping([det("1.30", 0.9, 100, 100, 36, 14), det("2.50", 0.7, 140, 100, 36, 14)], WINDOW);
    expect(merged.map((d) => d.value)).toEqual(["1.30", "2.50"]);
  });

  it("merges the same value read twice near one place, keeping the more confident reading", () => {
    // As from the two passes: boxes a few pixels apart that hardly overlap, inside the window.
    const merged = mergeOverlapping([det("1.30", 0.7, 100, 100, 36, 14), det("1.30", 0.9, 130, 110, 36, 14)], WINDOW);
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(0.9);
  });

  it("keeps the same value written twice when the two lie farther apart than the window", () => {
    expect(mergeOverlapping([det("1.30", 0.7, 100, 100, 36, 14), det("1.30", 0.9, 300, 100, 36, 14)], WINDOW)).toHaveLength(2);
  });

  it("merges different values whose quads overlap by half of the smaller one or more", () => {
    expect(mergeOverlapping([det("6.90", 0.9, 100, 100, 40, 14), det("6.98", 0.8, 120, 100, 40, 14)], WINDOW).map((d) => d.value)).toEqual(["6.90"]);
    expect(mergeOverlapping([det("6.90", 0.9, 100, 100, 40, 14), det("6.98", 0.8, 121, 100, 40, 14)], WINDOW)).toHaveLength(2);
  });

  describe("a prefix read only by the dropped reading of the same value", () => {
    const withSign = (d: Detection, prefix: string): Detection => ({ ...d, prefix, text: `${prefix}${d.value}` });

    it("goes to the kept reading when the kept quad holds the prefixed one", () => {
      // Kept "1.30" covers 100..150; the less confident "Ø1.30" lies inside it.
      const kept = det("1.30", 0.9, 100, 100, 50, 14);
      const dropped = withSign(det("1.30", 0.7, 102, 101, 46, 12), "Ø");
      const merged = mergeOverlapping([kept, dropped], WINDOW);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({ value: "1.30", prefix: "Ø", score: 0.9, box: kept.box });
      expect(kept.prefix).toBe(""); // the input is not changed
    });

    it("stays away when the sign lies outside the kept quad (it is then left on the page as it is)", () => {
      // Kept "1.30" covers 110..150 only; "Ø1.30" reaches out to 100: 80 % of it is inside.
      const merged = mergeOverlapping([det("1.30", 0.9, 110, 100, 40, 14), withSign(det("1.30", 0.7, 100, 100, 50, 14), "Ø")], WINDOW);
      expect(PREFIX_COVERED).toBeGreaterThan(0.8);
      expect(merged).toHaveLength(1);
      expect(merged[0].prefix).toBe("");
    });

    it("is not carried to a different value, nor over a prefix the kept reading has", () => {
      const other = mergeOverlapping([det("1.38", 0.9, 100, 100, 50, 14), withSign(det("1.30", 0.7, 102, 101, 46, 12), "Ø")], WINDOW);
      expect(other.map((d) => [d.value, d.prefix])).toEqual([["1.38", ""]]);
      const own = mergeOverlapping([withSign(det("1.30", 0.9, 100, 100, 50, 14), "R"), withSign(det("1.30", 0.7, 102, 101, 46, 12), "Ø")], WINDOW);
      expect(own.map((d) => d.prefix)).toEqual(["R"]);
    });

    it("is not carried from the same value read at another place nearby", () => {
      // Same value within the window, but the quads do not touch.
      const merged = mergeOverlapping([det("1.30", 0.9, 100, 100, 36, 14), withSign(det("1.30", 0.7, 140, 110, 36, 14), "Ø")], WINDOW);
      expect(merged).toHaveLength(1);
      expect(merged[0].prefix).toBe("");
    });
  });
});
