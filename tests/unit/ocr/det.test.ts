import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dbPostprocess, detInputSize, type DetBox } from "@/lib/ocr/det";

type DetCase = {
  mapW: number;
  mapH: number;
  srcW: number;
  srcH: number;
  prob: number[];
  boxes: [number, number][][];
  scores: number[];
};

function load(name: string): DetCase {
  return JSON.parse(readFileSync(path.join(process.cwd(), "tests/unit/ocr/fixtures", name), "utf8"));
}

const centre = (pts: { x: number; y: number }[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

function expectSameBoxes(actual: DetBox[], c: DetCase) {
  expect(actual).toHaveLength(c.boxes.length);
  const expected = c.boxes.map((b, i) => ({ quad: b.map(([x, y]) => ({ x, y })), score: c.scores[i] }));
  for (const e of expected) {
    const ec = centre(e.quad);
    const match = actual.find((a) => Math.hypot(centre(a.quad).x - ec.x, centre(a.quad).y - ec.y) < 4);
    expect(match, `a box near (${ec.x}, ${ec.y})`).toBeDefined();
    e.quad.forEach((p, k) => {
      expect(Math.abs(match!.quad[k].x - p.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(match!.quad[k].y - p.y)).toBeLessThanOrEqual(2);
    });
    expect(Math.abs(match!.score - e.score)).toBeLessThanOrEqual(0.02);
  }
}

describe("detInputSize", () => {
  it("scales the shorter side up to 736 and rounds to multiples of 32", () => {
    expect(detInputSize(256, 256)).toEqual({ width: 736, height: 736 });
    expect(detInputSize(350, 350)).toEqual({ width: 736, height: 736 });
    expect(detInputSize(64, 32)).toEqual({ width: 1472, height: 736 });
  });

  it("only rounds an image that is already large enough, halves to even like Python", () => {
    expect(detInputSize(1984, 1504)).toEqual({ width: 1984, height: 1504 });
    expect(detInputSize(2000, 1519)).toEqual({ width: 1984, height: 1504 }); // 2000 / 32 = 62.5 → 62
  });
});

describe("dbPostprocess matches RapidOCR", () => {
  for (const name of ["det-mixed.json", "det-vertical.json"]) {
    it(name, () => {
      const c = load(name);
      expectSameBoxes(dbPostprocess(Float32Array.from(c.prob), c.mapW, c.mapH, c.srcW, c.srcH), c);
    });
  }

  it("finds nothing in an empty map", () => {
    expect(dbPostprocess(new Float32Array(32 * 32), 32, 32, 32, 32)).toEqual([]);
  });
});
