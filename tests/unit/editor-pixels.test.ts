import { describe, expect, it } from "vitest";
import { createRaster, rotate90cw, type Raster } from "@/lib/ocr/raster";
import { axes } from "@/editor/geometry";
import { analyseBox } from "@/editor/pixels";

function fill(r: Raster, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * r.width + x) * 4;
      r.data[i] = rgb[0];
      r.data[i + 1] = rgb[1];
      r.data[i + 2] = rgb[2];
      r.data[i + 3] = 255;
    }
  }
}

const INK: [number, number, number] = [0x67, 0x66, 0x72];
const GREEN: [number, number, number] = [0x2e, 0x9e, 0x4f];

/** "2.50"-like glyph blocks at x 100–158, y 50–69, a dimension line 5 rows below them. */
function scene(paper = 255): Raster {
  const r = createRaster(300, 150, paper);
  fill(r, 100, 50, 110, 69, INK);
  fill(r, 114, 50, 124, 69, INK);
  fill(r, 128, 67, 130, 69, INK); // the decimal point
  fill(r, 134, 50, 144, 69, INK);
  fill(r, 148, 50, 158, 69, INK);
  fill(r, 60, 75, 220, 76, GREEN);
  return r;
}

const near = (a: number, b: number, eps = 0.51) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe("analyseBox", () => {
  it("tightens a horizontal reading to the digits and leaves the dimension line out", () => {
    const result = analyseBox(scene(), { cx: 129, cy: 64, w: 80, h: 30, angle: 0 });
    expect(result).not.toBeNull();
    const { tight, textColor, bgColor } = result!;
    near(tight.cx, 129);
    near(tight.cy, 59.5);
    expect(tight.w).toBe(59);
    expect(tight.h).toBe(20);
    expect(tight.angle).toBe(0);
    expect(textColor).toBe("#676672");
    expect(bgColor).toBe("#ffffff");
  });

  it("does the same for vertical text read top-down", () => {
    // Turned clockwise, (x, y) moves to (149 - y, x): the text now reads top-down (angle 90).
    const result = analyseBox(rotate90cw(scene()), { cx: 85, cy: 129, w: 80, h: 30, angle: 90 });
    expect(result).not.toBeNull();
    near(result!.tight.cx, 89.5);
    near(result!.tight.cy, 129);
    expect(result!.tight.w).toBe(59);
    expect(result!.tight.h).toBe(20);
  });

  it("samples a paper colour that is not white", () => {
    const result = analyseBox(scene(242), { cx: 129, cy: 64, w: 80, h: 30, angle: 0 });
    expect(result!.bgColor).toBe("#f2f2f2");
  });

  it("keeps the ink colour when the digits cover under 2 % of a large drawn box", () => {
    const r = createRaster(400, 300);
    fill(r, 190, 140, 195, 159, INK); // a lone "1": 120 ink pixels in a 300 × 200 box (0.2 %)
    const result = analyseBox(r, { cx: 200, cy: 150, w: 300, h: 200, angle: 0 });
    expect(result?.textColor).toBe("#676672");
    expect(result?.tight.w).toBe(6);
    expect(result?.tight.h).toBe(20);
  });

  it("treats a few specks as no text", () => {
    const r = createRaster(300, 150);
    fill(r, 120, 60, 121, 61, INK); // 4 dark pixels
    expect(analyseBox(r, { cx: 129, cy: 64, w: 80, h: 30, angle: 0 })).toBeNull();
  });

  it("finds no text in a blank box", () => {
    expect(analyseBox(createRaster(300, 150), { cx: 150, cy: 75, w: 60, h: 20, angle: 0 })).toBeNull();
  });

  it("copes with a box that runs off the page", () => {
    expect(() => analyseBox(scene(), { cx: 5, cy: 5, w: 60, h: 30, angle: 30 })).not.toThrow();
  });

  it("keeps the ink colour of thin digits that cover little of the box", () => {
    const r = createRaster(300, 150);
    // four 1-pixel strokes, 20 px tall (about 3 % of the box), each with anti-aliased grey on both sides
    for (const x of [104, 118, 138, 152]) {
      fill(r, x - 1, 50, x - 1, 69, [0xb0, 0xb0, 0xb6]);
      fill(r, x + 1, 50, x + 1, 69, [0xb0, 0xb0, 0xb6]);
      fill(r, x, 50, x, 69, INK);
    }
    expect(analyseBox(r, { cx: 129, cy: 64, w: 80, h: 30, angle: 0 })?.textColor).toBe("#676672");
  });
});

describe("analyseBox: which run is the digits", () => {
  const box = { cx: 100, cy: 50, w: 80, h: 30, angle: 0 };

  function twoRuns(edgeRows: number, middleRows: number, middleWidth: number): Raster {
    const r = createRaster(200, 100);
    fill(r, 70, 36, 129, 36 + edgeRows - 1, INK); // at the top edge of the box (t = -14 ...)
    fill(r, 80, 48, 80 + middleWidth - 1, 48 + middleRows - 1, INK); // across the middle (t = -2 ...)
    return r;
  }

  it("takes the run nearer the centre when the two biggest are less than twice apart", () => {
    // edge 5 x 60 = 300 dark pixels, middle 4 x 50 = 200: 1.5 times
    const result = analyseBox(twoRuns(5, 4, 50), box);
    expect(result!.tight.h).toBe(4);
    near(result!.tight.cy, 49.5);
  });

  it("still takes the edge run when it is more than twice as strong", () => {
    // edge 5 x 60 = 300 dark pixels, middle 2 x 40 = 80
    const result = analyseBox(twoRuns(5, 2, 40), box);
    expect(result!.tight.h).toBe(5);
    near(result!.tight.cy, 38);
  });
});

describe("analyseBox: other angles", () => {
  /** Ink wherever a pixel lies inside the rotated rectangle (s along the text, t across it). */
  function line(angle: number, cx: number, cy: number, halfW: number, halfH: number): Raster {
    const r = createRaster(300, 200);
    const { u, v } = axes(angle);
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const s = (x - cx) * u.x + (y - cy) * u.y;
        const t = (x - cx) * v.x + (y - cy) * v.y;
        if (Math.abs(s) <= halfW && Math.abs(t) <= halfH) fill(r, x, y, x, y, INK);
      }
    }
    return r;
  }

  it("tightens a text line read upside-down (180°)", () => {
    const turned = rotate90cw(rotate90cw(scene())); // (x, y) moves to (299 - x, 149 - y)
    const result = analyseBox(turned, { cx: 170, cy: 85, w: 80, h: 30, angle: 180 });
    expect(result).not.toBeNull();
    near(result!.tight.cx, 170);
    near(result!.tight.cy, 89.5);
    expect(result!.tight.w).toBe(59);
    expect(result!.tight.h).toBe(20);
    expect(result!.tight.angle).toBe(180);
  });

  it("tightens a real 30° text line, and leaves the box angle alone", () => {
    const result = analyseBox(line(30, 150, 100, 30, 6), { cx: 150, cy: 100, w: 90, h: 30, angle: 30 });
    expect(result).not.toBeNull();
    const { tight } = result!;
    near(tight.cx, 150, 1);
    near(tight.cy, 100, 1);
    near(tight.w, 61, 2);
    near(tight.h, 13, 2);
    expect(tight.angle).toBe(30);
  });
});
