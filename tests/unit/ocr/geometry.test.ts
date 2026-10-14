import { describe, expect, it } from "vitest";
import {
  bounds,
  convexHull,
  convexIntersectionArea,
  coveredShare,
  expandRect,
  minAreaRect,
  miniBox,
  normalizeAngle,
  orderClockwise,
  overlapShare,
  polygonArea,
  polygonPerimeter,
  pyRound,
  type Point,
  type Quad,
} from "@/lib/ocr/geometry";

const pt = (x: number, y: number): Point => ({ x, y });
const close = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("pyRound", () => {
  it("rounds halves to the even neighbour like Python", () => {
    expect(pyRound(62.5)).toBe(62);
    expect(pyRound(63.5)).toBe(64);
    expect(pyRound(-2.5)).toBe(-2);
    expect(pyRound(2.4)).toBe(2);
    expect(pyRound(2.6)).toBe(3);
  });
});

describe("convexHull", () => {
  it("drops interior and duplicate points", () => {
    const hull = convexHull([pt(0, 0), pt(4, 0), pt(4, 3), pt(0, 3), pt(2, 1), pt(0, 0), pt(2, 0)]);
    expect(hull).toHaveLength(4);
    expect(polygonArea(hull)).toBe(12);
  });

  it("keeps a single point", () => {
    expect(convexHull([pt(1, 1), pt(1, 1)])).toEqual([pt(1, 1)]);
  });
});

describe("minAreaRect", () => {
  it("fits an axis-aligned block of pixels", () => {
    const pixels: Point[] = [];
    for (let y = 0; y <= 2; y++) for (let x = 0; x <= 9; x++) pixels.push(pt(x, y));
    const r = minAreaRect(pixels);
    expect(r.width * r.height).toBeCloseTo(18, 6);
    expect(Math.min(r.width, r.height)).toBeCloseTo(2, 6);
  });

  it("fits a rectangle turned by 30°", () => {
    const a = Math.PI / 6;
    const corner = (u: number, v: number) => pt(50 + u * Math.cos(a) - v * Math.sin(a), 40 + u * Math.sin(a) + v * Math.cos(a));
    const r = minAreaRect([corner(-20, -5), corner(20, -5), corner(20, 5), corner(-20, 5), corner(0, 0)]);
    expect(r.width * r.height).toBeCloseTo(400, 4);
    expect(Math.max(r.width, r.height)).toBeCloseTo(40, 4);
  });
});

describe("miniBox", () => {
  it("orders the corners tl, tr, br, bl and reports the shorter side", () => {
    const box = miniBox([pt(10, 20), pt(40, 20), pt(40, 30), pt(10, 30), pt(25, 25)]);
    expect(box.shortSide).toBeCloseTo(10, 6);
    close(box.quad[0], pt(10, 20));
    close(box.quad[1], pt(40, 20));
    close(box.quad[2], pt(40, 30));
    close(box.quad[3], pt(10, 30));
  });
});

describe("expandRect", () => {
  it("grows every side by d around the same centre", () => {
    const quad: Quad = [pt(0, 0), pt(10, 0), pt(10, 4), pt(0, 4)];
    const grown = expandRect(quad, 2);
    close(grown[0], pt(-2, -2));
    close(grown[2], pt(12, 6));
    expect(polygonPerimeter(grown)).toBeCloseTo(44, 6);
  });
});

describe("orderClockwise and bounds", () => {
  it("returns tl, tr, br, bl from any order", () => {
    expect(orderClockwise([pt(9, 9), pt(1, 1), pt(9, 1), pt(1, 9)])).toEqual([pt(1, 1), pt(9, 1), pt(9, 9), pt(1, 9)]);
  });

  it("bounds a set of points", () => {
    expect(bounds([pt(3, 7), pt(1, 2), pt(5, 4)])).toEqual({ x: 1, y: 2, w: 4, h: 5 });
  });
});

describe("normalizeAngle", () => {
  it("maps any angle into (-180, 180]", () => {
    expect(normalizeAngle(270)).toBe(-90);
    expect(normalizeAngle(-270)).toBe(90);
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(0)).toBe(0);
  });
});

describe("convexIntersectionArea and overlapShare", () => {
  const rect = (x: number, y: number, w: number, h: number): Quad => [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)];
  /** A w x h rectangle turned `degrees` around (cx, cy), corners in the detector's order. */
  const turned = (cx: number, cy: number, w: number, h: number, degrees: number): Quad => {
    const a = (degrees * Math.PI) / 180;
    const at = (s: number, t: number) => pt(cx + s * Math.cos(a) - t * Math.sin(a), cy + s * Math.sin(a) + t * Math.cos(a));
    return orderClockwise([at(-w / 2, -h / 2), at(w / 2, -h / 2), at(w / 2, h / 2), at(-w / 2, h / 2)]);
  };

  it("measures the common area of two rectangles along the axes", () => {
    expect(convexIntersectionArea(rect(0, 0, 10, 4), rect(5, 0, 10, 4))).toBeCloseTo(20, 9);
    expect(convexIntersectionArea(rect(0, 0, 10, 4), rect(2, 1, 3, 2))).toBeCloseTo(6, 9);
    expect(convexIntersectionArea(rect(0, 0, 10, 4), rect(20, 0, 10, 4))).toBe(0);
    expect(convexIntersectionArea(rect(0, 0, 10, 4), rect(10, 0, 10, 4))).toBeCloseTo(0, 9); // touching edges
  });

  it("measures turned rectangles: a square and itself turned 45° share a regular octagon", () => {
    const square = rect(0, 0, 1, 1);
    const diamond = turned(0.5, 0.5, 1, 1, 45);
    expect(convexIntersectionArea(square, diamond)).toBeCloseTo(2 * (Math.SQRT2 - 1), 9);
    expect(convexIntersectionArea(diamond, square)).toBeCloseTo(2 * (Math.SQRT2 - 1), 9);
  });

  it("does not depend on the corners' order or direction", () => {
    const a = turned(50, 40, 40, 12, 30);
    const b = rect(40, 30, 30, 20);
    const reversed = [...b].reverse() as Quad;
    expect(convexIntersectionArea(a, reversed)).toBeCloseTo(convexIntersectionArea(a, b), 9);
    expect(convexIntersectionArea([...a].reverse(), b)).toBeCloseTo(convexIntersectionArea(a, b), 9);
  });

  it("gives the share of the smaller quad that the other covers", () => {
    expect(overlapShare(rect(0, 0, 10, 4), rect(5, 0, 10, 4))).toBeCloseTo(0.5, 9);
    expect(overlapShare(rect(0, 0, 10, 4), rect(2, 1, 3, 2))).toBeCloseTo(1, 9); // the small one lies inside
    expect(overlapShare(rect(2, 1, 3, 2), rect(0, 0, 10, 4))).toBeCloseTo(1, 9);
    expect(overlapShare(rect(0, 0, 10, 4), rect(30, 0, 10, 4))).toBe(0);
    expect(overlapShare(rect(0, 0, 10, 4), turned(5, 2, 10, 4, 90))).toBeCloseTo(16 / 40, 9);
  });

  it("is 0 for a quad without area", () => {
    expect(overlapShare(rect(0, 0, 10, 4), rect(2, 2, 5, 0))).toBe(0);
  });

  it("coveredShare gives how much of the first quad lies inside the second", () => {
    expect(coveredShare(rect(2, 1, 3, 2), rect(0, 0, 10, 4))).toBeCloseTo(1, 9);
    expect(coveredShare(rect(0, 0, 10, 4), rect(2, 1, 3, 2))).toBeCloseTo(6 / 40, 9);
    expect(coveredShare(rect(0, 0, 10, 4), rect(2, 0, 10, 4))).toBeCloseTo(0.8, 9);
    expect(coveredShare(rect(0, 0, 10, 4), rect(30, 0, 10, 4))).toBe(0);
    expect(coveredShare(rect(2, 2, 5, 0), rect(0, 0, 10, 4))).toBe(0);
  });
});
