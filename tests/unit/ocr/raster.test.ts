import { describe, expect, it } from "vitest";
import type { Quad } from "@/lib/ocr/geometry";
import {
  createRaster,
  crop,
  cropQuad,
  resizeBilinear,
  rotate180,
  rotate90ccw,
  rotate90cw,
  rotateExpand,
  toBgrCHW,
  unrotatePoint,
  type Raster,
} from "@/lib/ocr/raster";

/** A raster from grey levels, row by row. */
function grey(rows: number[][]): Raster {
  const r = createRaster(rows[0].length, rows.length);
  rows.forEach((row, y) =>
    row.forEach((v, x) => {
      const i = (y * r.width + x) * 4;
      r.data[i] = v;
      r.data[i + 1] = v;
      r.data[i + 2] = v;
    }),
  );
  return r;
}
const levels = (r: Raster) =>
  Array.from({ length: r.height }, (_, y) => Array.from({ length: r.width }, (_, x) => r.data[(y * r.width + x) * 4]));

describe("raster basics", () => {
  it("creates an opaque raster of one grey level", () => {
    const r = createRaster(2, 1, 7);
    expect(Array.from(r.data)).toEqual([7, 7, 7, 255, 7, 7, 7, 255]);
  });

  it("crops and fills outside the source with white", () => {
    const r = crop(grey([[1, 2], [3, 4]]), { x: 1, y: 0, w: 2, h: 2 });
    expect(levels(r)).toEqual([[2, 255], [4, 255]]);
  });

  it("resizes with pixel-centre alignment", () => {
    expect(levels(resizeBilinear(grey([[0, 255]]), 4, 1))).toEqual([[0, 64, 191, 255]]);
  });
});

describe("rotations", () => {
  const src = grey([[1, 2, 3], [4, 5, 6]]);

  it("turns a quarter clockwise", () => {
    expect(levels(rotate90cw(src))).toEqual([[4, 1], [5, 2], [6, 3]]);
  });

  it("turns a quarter counter-clockwise", () => {
    expect(levels(rotate90ccw(src))).toEqual([[3, 6], [2, 5], [1, 4]]);
  });

  it("turns half way", () => {
    expect(levels(rotate180(src))).toEqual([[6, 5, 4], [3, 2, 1]]);
  });

  it("rotateExpand by 90° matches the exact quarter turn", () => {
    expect(levels(rotateExpand(src, 90))).toEqual(levels(rotate90ccw(src)));
    expect(levels(rotateExpand(src, -90))).toEqual(levels(rotate90cw(src)));
  });

  it("rotateExpand grows the canvas and paints new corners white", () => {
    const out = rotateExpand(createRaster(10, 10, 0), 45);
    expect(out.width).toBe(15);
    expect(out.height).toBe(15);
    expect(out.data[0]).toBe(255);
    expect(out.data[((7 * out.width) + 7) * 4]).toBe(0);
  });

  it("unrotatePoint inverts the turn", () => {
    const p = unrotatePoint({ x: 0.5, y: 0.5 }, 3, 2, 2, 3, 90);
    expect(p.x).toBeCloseTo(2.5, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
  });
});

describe("cropQuad", () => {
  it("equals a plain crop for an upright box", () => {
    const src = grey([[1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14], [15, 16, 17, 18, 19, 20, 21], [22, 23, 24, 25, 26, 27, 28]]);
    const quad: Quad = [{ x: 2, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 3 }, { x: 2, y: 3 }];
    expect(levels(cropQuad(src, quad))).toEqual(levels(crop(src, { x: 2, y: 1, w: 4, h: 2 })));
  });

  it("turns a tall crop so the text runs left to right", () => {
    const out = cropQuad(createRaster(10, 10), [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 6 }, { x: 0, y: 6 }]);
    expect(out.width).toBe(6);
    expect(out.height).toBe(2);
  });
});

describe("toBgrCHW", () => {
  it("normalises to [-1, 1] in B, G, R order", () => {
    const r = createRaster(1, 1);
    r.data.set([255, 0, 0, 255]);
    expect(Array.from(toBgrCHW(r))).toEqual([-1, -1, 1]);
  });
});
