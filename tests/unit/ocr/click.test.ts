import { describe, expect, it } from "vitest";
import { CLICK_ANGLES, readAtPoint } from "@/lib/ocr/click";
import type { OcrModels, RegionReader } from "@/lib/ocr/pipeline";
import { createRaster } from "@/lib/ocr/raster";

const models = {} as OcrModels;
const page = createRaster(1135, 877);

describe("readAtPoint (UC-06)", () => {
  it("stops at the first angle that yields a dimension and maps the box to the page", async () => {
    const seen: number[] = [];
    const read: RegionReader = async (_m, image, opts) => {
      expect(opts?.bothDirections).toBe(true);
      seen.push(image.width);
      return [{ text: "1630", score: 0.95, turn: 0, quad: [{ x: 96, y: 112 }, { x: 160, y: 112 }, { x: 160, y: 144 }, { x: 96, y: 144 }] }];
    };
    const result = await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read);
    expect(result.anglesTried).toBe(1);
    expect(result.reading?.value).toBe("16.30");
    expect(result.reading?.angle).toBe(0);
    // side = round(0.056 × 1135) = 64 → crop origin (268, 568), scale 64 / 256 = 0.25
    expect(result.reading?.box).toEqual({ x: 292, y: 596, w: 16, h: 8 });
    expect(seen).toEqual([256]);
  });

  it("tries the other angles in order when nothing is read", async () => {
    let calls = 0;
    const read: RegionReader = async () => {
      calls++;
      return calls < 3 ? [] : [{ text: "2.50", score: 0.8, turn: 0, quad: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }] }];
    };
    const result = await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read);
    expect(result.anglesTried).toBe(3);
    expect(result.reading?.angle).toBe(CLICK_ANGLES[2]);
  });

  it("gives up at the deadline", async () => {
    const read: RegionReader = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return [];
    };
    const result = await readAtPoint(models, page, { x: 300, y: 600 }, 20, read);
    expect(result.reading).toBeNull();
    expect(result.anglesTried).toBe(1);
  });

  it("prefers the value nearest the click over a more confident neighbour", async () => {
    const read: RegionReader = async () => [
      { text: "9.99", score: 0.99, turn: 0, quad: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 16 }, { x: 0, y: 16 }] },
      { text: "1630", score: 0.8, turn: 0, quad: [{ x: 112, y: 120 }, { x: 144, y: 120 }, { x: 144, y: 136 }, { x: 112, y: 136 }] },
    ];
    const result = await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read);
    expect(result.reading?.value).toBe("16.30");
  });

  it("maps a box read in a turned image back to the page", async () => {
    let calls = 0;
    const read: RegionReader = async (_m, image) => {
      calls++;
      if (calls < 3) return []; // 0° and -90° read nothing; 90° is the third angle
      expect([image.width, image.height]).toEqual([256, 256]);
      return [{ text: "2.50", score: 0.9, turn: 0, quad: [{ x: 96, y: 112 }, { x: 160, y: 112 }, { x: 160, y: 144 }, { x: 96, y: 144 }] }];
    };
    const result = await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read);
    expect(result.reading?.angle).toBe(90);
    // A quarter turn counter-clockwise: turned pixel (x, y) came from square pixel (255 - y, x), so the box
    // covers square x 111..143, y 96..160 → page (268 + x / 4, 568 + y / 4).
    const box = result.reading!.box;
    expect(box.x).toBeCloseTo(295.75, 6);
    expect(box.y).toBeCloseTo(592, 6);
    expect(box.w).toBeCloseTo(8, 6);
    expect(box.h).toBeCloseTo(16, 6);
  });

  it("reports the text's own angle: the image turn plus the turns made while reading", async () => {
    const cases: [number, 0 | 90 | 180 | 270, number][] = [
      [0, 90, 90], // tall crop, read as RapidOCR turns it: top-down text
      [0, 270, -90], // tall crop read upside down: bottom-up text
      [-90, 180, 90], // turned clockwise, then read upside down
    ];
    for (const [imageTurn, turn, expected] of cases) {
      let calls = 0;
      const read: RegionReader = async () => {
        calls++;
        if (CLICK_ANGLES[calls - 1] !== imageTurn) return [];
        return [{ text: "2.50", score: 0.9, turn, quad: [{ x: 120, y: 120 }, { x: 136, y: 120 }, { x: 136, y: 136 }, { x: 120, y: 136 }] }];
      };
      const result = await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read);
      expect(result.reading?.angle).toBe(expected);
    }
  });

  it("tries upright, then vertical, then diagonal", () => {
    expect([...CLICK_ANGLES]).toEqual([0, -90, 90, 60, -60]);
  });

  it("does not start an angle that cannot finish before the deadline", async () => {
    // One angle takes 200 ms and the deadline is 300 ms, so a second angle must not start. The count of
    // angles tried is the check; elapsed time is not asserted, because a busy machine stretches it.
    const read: RegionReader = async () => {
      await new Promise((r) => setTimeout(r, 200));
      return [];
    };
    const result = await readAtPoint(models, page, { x: 300, y: 600 }, 300, read);
    expect(result.anglesTried).toBe(1);
    expect(result.reading).toBeNull();
  });

  it("asks the reader to re-read upside down only non-dimensions", async () => {
    let accept: ((text: string) => boolean) | undefined;
    const read: RegionReader = async (_m, _image, opts) => {
      accept = opts?.accept;
      return [];
    };
    await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read);
    expect(accept?.("1630")).toBe(true);
    expect(accept?.("1.5p")).toBe(false);
  });
});
