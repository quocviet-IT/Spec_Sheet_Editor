import { describe, expect, it } from "vitest";
import { CLICK_ANGLES, readAtPoint } from "@/lib/ocr/click";
import { orderClockwise, type Quad } from "@/lib/ocr/geometry";
import type { OcrModels, RegionReader } from "@/lib/ocr/pipeline";
import { createRaster } from "@/lib/ocr/raster";
import { fakeModels } from "./fake-models";

const models = {} as OcrModels;
const page = createRaster(1135, 877);
/** A w × h text box turned `degrees` (y down) around (cx, cy), in the detector's corner order. */
const turnedBox = (cx: number, cy: number, w: number, h: number, degrees: number): Quad => {
  const a = (degrees * Math.PI) / 180;
  const at = (s: number, t: number) => ({ x: cx + s * Math.cos(a) - t * Math.sin(a), y: cy + s * Math.sin(a) + t * Math.cos(a) });
  return orderClockwise([at(-w / 2, -h / 2), at(w / 2, -h / 2), at(w / 2, h / 2), at(-w / 2, h / 2)]);
};

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

  it("keeps a slanted value's own angle: its quad's in the turned image, plus the image's turn", async () => {
    let calls = 0;
    const read: RegionReader = async (_m, image) => {
      calls++;
      if (CLICK_ANGLES[calls - 1] !== 60) return [];
      return [{ text: "2.50", score: 0.9, turn: 0, quad: turnedBox(image.width / 2, image.height / 2, 64, 16, -10) }];
    };
    const result = await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read);
    expect(result.reading?.angle).toBeCloseTo(50, 6);
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

  it("asks the reader to re-read upside down everything but a value with its decimal separator written", async () => {
    let accept: ((text: string) => boolean) | undefined;
    const read: RegionReader = async (_m, _image, opts) => {
      accept = opts?.accept;
      return [];
    };
    await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read);
    expect(accept?.("16.30")).toBe(true);
    expect(accept?.("16,30")).toBe(true);
    expect(accept?.("Ø1.30")).toBe(true);
    // Only repaired from digits: the upside-down reading may be the value with its point ("069" is "6.90").
    expect(accept?.("1630")).toBe(false);
    expect(accept?.("069")).toBe(false);
    expect(accept?.("1.5p")).toBe(false);
  });

  it("rejects a value only repaired from digits where a value with its point written covers the same place", async () => {
    const read: RegionReader = async () => [
      { text: "069", score: 0.97, turn: 0, quad: [{ x: 112, y: 120 }, { x: 144, y: 120 }, { x: 144, y: 136 }, { x: 112, y: 136 }] },
      { text: "6.90", score: 0.8, turn: 0, quad: [{ x: 110, y: 119 }, { x: 146, y: 119 }, { x: 146, y: 137 }, { x: 110, y: 137 }] },
    ];
    const result = await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read);
    expect(result.reading?.value).toBe("6.90");
  });

  it("still repairs a value whose point was lost when nothing with a point covers it", async () => {
    const read: RegionReader = async () => [
      { text: "170", score: 0.9, turn: 0, quad: [{ x: 112, y: 120 }, { x: 144, y: 120 }, { x: 144, y: 136 }, { x: 112, y: 136 }] },
    ];
    expect((await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read)).reading?.value).toBe("1.70");
  });

  describe("through the real reader: the upside-down reading wins only with its point written", () => {
    const click = async (upright: { text: string; score: number }, upsideDown: { text: string; score: number }) =>
      (await readAtPoint(fakeModels([upright, upsideDown]), page, { x: 300, y: 600 })).reading;

    it("keeps the upright reading when neither has its point written, however confident the other", async () => {
      expect(await click({ text: "690", score: 0.9 }, { text: "069", score: 0.95 })).toMatchObject({ value: "6.90", angle: 0 });
      expect(await click({ text: "180", score: 0.88 }, { text: "081", score: 0.9 })).toMatchObject({ value: "1.80", angle: 0 });
      expect(await click({ text: "080", score: 0.8 }, { text: "080", score: 0.8 })).toMatchObject({ value: "0.80", angle: 0 });
    });

    it("keeps an upright value when the upside-down reading is not one", async () => {
      expect(await click({ text: "170", score: 0.8 }, { text: "0L1", score: 0.85 })).toMatchObject({ value: "1.70", angle: 0 });
    });

    it("takes the upside-down value with its point written over upright digits", async () => {
      expect(await click({ text: "069", score: 0.95 }, { text: "6.90", score: 0.7 })).toMatchObject({ value: "6.90", angle: 180 });
    });
  });

  it("keeps what is written in front of the value", async () => {
    const read: RegionReader = async () => [
      { text: "2X 01.10", score: 0.9, turn: 0, quad: [{ x: 96, y: 112 }, { x: 160, y: 112 }, { x: 160, y: 144 }, { x: 96, y: 144 }] },
    ];
    const { reading } = await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read);
    expect(reading).toMatchObject({ value: "1.10", prefix: "2X Ø", text: "2X 01.10" });
  });
});
