import { describe, expect, it } from "vitest";
import type { Quad } from "@/lib/ocr/geometry";
import {
  axes, boxCorners, boxForDrawnRect, boxFromQuad, centreInDrawingArea, detectionAt, drawingAreaPx, panelOf,
  pointInDrawingArea, readingOrder, rectFromDrag, rectInDrawingArea, roundAngle, roundBox, sameSize, toBox, toPx,
} from "@/editor/geometry";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe("reading axes", () => {
  it("0° reads left to right; -90° reads bottom-up; 90° reads top-down", () => {
    const h = axes(0);
    close(h.u.x, 1); close(h.u.y, 0); close(h.v.x, 0); close(h.v.y, 1);
    const up = axes(-90);
    close(up.u.x, 0); close(up.u.y, -1); close(up.v.x, 1); close(up.v.y, 0);
    const down = axes(90);
    close(down.u.x, 0); close(down.u.y, 1); close(down.v.x, -1); close(down.v.y, 0);
  });
});

describe("boxFromQuad", () => {
  it("measures a horizontal reading along and across the text", () => {
    const quad: Quad = [{ x: 100, y: 50 }, { x: 160, y: 50 }, { x: 160, y: 70 }, { x: 100, y: 70 }];
    expect(boxFromQuad(quad, 0)).toEqual({ cx: 130, cy: 60, w: 60, h: 20, angle: 0 });
  });

  it("does not depend on the corner order (the detector's order is not the text's)", () => {
    const quad: Quad = [{ x: 160, y: 70 }, { x: 100, y: 70 }, { x: 100, y: 50 }, { x: 160, y: 50 }];
    expect(boxFromQuad(quad, 0)).toEqual({ cx: 130, cy: 60, w: 60, h: 20, angle: 0 });
  });

  it("puts the long side of a vertical reading along the text", () => {
    const quad: Quad = [{ x: 100, y: 200 }, { x: 120, y: 200 }, { x: 120, y: 260 }, { x: 100, y: 260 }];
    const box = boxFromQuad(quad, -90);
    close(box.cx, 110); close(box.cy, 230); close(box.w, 60); close(box.h, 20);
    expect(box.angle).toBe(-90);
  });

  it("recovers a box at any angle from its own corners", () => {
    const original = { cx: 400, cy: 300, w: 80, h: 24, angle: 58 };
    const back = boxFromQuad(boxCorners(original), 58);
    close(back.cx, 400, 1e-6); close(back.cy, 300, 1e-6); close(back.w, 80, 1e-6); close(back.h, 24, 1e-6);
  });

  it("normalises the angle to (-180, 180]", () => {
    const quad: Quad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }];
    expect(boxFromQuad(quad, 270).angle).toBe(-90);
  });
});

describe("fractions and pixels", () => {
  it("measures both sizes against the page width", () => {
    const box = toBox({ cx: 1650, cy: 1275, w: 66, h: 33, angle: -90 }, 3300, 2550);
    expect(box).toEqual({ cx: 0.5, cy: 0.5, w: 0.02, h: 0.01 });
    expect(toPx(box, -90, 3300, 2550)).toEqual({ cx: 1650, cy: 1275, w: 66, h: 33, angle: -90 });
  });

  it("rounds stored numbers", () => {
    expect(roundBox({ cx: 0.1234567, cy: 0.9876543, w: 0.0000049, h: 0.333333333 })).toEqual({ cx: 0.12346, cy: 0.98765, w: 0, h: 0.33333 });
    expect(roundAngle(-89.99999999)).toBe(-90);
    expect(roundAngle(57.996)).toBe(58);
    expect(roundAngle(-179.996)).toBe(180);
    expect(roundAngle(180.004)).toBe(180);
    expect(Object.is(roundAngle(-0.001), 0)).toBe(true);
    expect(Object.is(roundBox({ cx: -0.000001, cy: 0.5, w: 0.1, h: 0.1 }).cx, 0)).toBe(true);
  });
});

describe("drawing area and panels", () => {
  it("gives the drawing area in pixels of a 300-DPI page", () => {
    expect(drawingAreaPx(3300, 2550)).toEqual({ x: 152, y: 339, w: 2059, h: 1563 });
  });

  it("keeps values whose centre lies inside the four panels (BR-02)", () => {
    expect(centreInDrawingArea({ cx: 0.2, cy: 0.3, w: 0.01, h: 0.005 })).toBe(true);
    expect(centreInDrawingArea({ cx: 0.8, cy: 0.3, w: 0.01, h: 0.005 })).toBe(false); // right-hand table
    expect(centreInDrawingArea({ cx: 0.2, cy: 0.85, w: 0.01, h: 0.005 })).toBe(false); // bottom boxes
    expect(centreInDrawingArea({ cx: 0.2, cy: 0.05, w: 0.01, h: 0.005 })).toBe(false); // header
  });

  it("names the panel holding a value", () => {
    expect(panelOf({ cx: 0.1, cy: 0.2, w: 0, h: 0 })).toBe("topLeft");
    expect(panelOf({ cx: 0.6, cy: 0.2, w: 0, h: 0 })).toBe("topRight");
    expect(panelOf({ cx: 0.1, cy: 0.7, w: 0, h: 0 })).toBe("bottomLeft");
    expect(panelOf({ cx: 0.6, cy: 0.7, w: 0, h: 0 })).toBe("bottomRight");
  });

  it("orders values panel by panel, then top to bottom, then left to right", () => {
    const at = (id: string, cx: number, cy: number) => ({ id, box: { cx, cy, w: 0.01, h: 0.005 } });
    const order = readingOrder([at("br", 0.6, 0.7), at("tl2", 0.1, 0.3), at("tr", 0.6, 0.2), at("tl1", 0.2, 0.2), at("bl", 0.1, 0.7)]);
    expect(order.map((o) => o.id)).toEqual(["tl1", "tl2", "tr", "bl", "br"]);
  });
});

describe("sameSize", () => {
  it("accepts the stored size give or take two pixels", () => {
    expect(sameSize(3300, 2550, 3300, 2550)).toBe(true);
    expect(sameSize(3302, 2549, 3300, 2550)).toBe(true);
    expect(sameSize(3303, 2550, 3300, 2550)).toBe(false);
    expect(sameSize(3300, 2547, 3300, 2550)).toBe(false);
  });
});

describe("drawn boxes (UC-07)", () => {
  it("turns a drag in any direction into a rectangle", () => {
    expect(rectFromDrag({ x: 300, y: 200 }, { x: 260, y: 230 })).toEqual({ x: 260, y: 200, w: 40, h: 30 });
  });

  it("accepts a rectangle only when every corner is inside the four panels", () => {
    expect(rectInDrawingArea({ x: 400, y: 600, w: 80, h: 30 }, 3300, 2550)).toBe(true);
    expect(rectInDrawingArea({ x: 2180, y: 600, w: 80, h: 30 }, 3300, 2550)).toBe(false); // runs into the right-hand table
    expect(rectInDrawingArea({ x: 400, y: 320, w: 80, h: 30 }, 3300, 2550)).toBe(false); // starts in the header band
  });

  it("knows whether a click lies inside the drawing", () => {
    expect(pointInDrawingArea({ x: 400, y: 600 }, 3300, 2550)).toBe(true);
    expect(pointInDrawingArea({ x: 2700, y: 600 }, 3300, 2550)).toBe(false);
  });

  it("takes the drawn rectangle as the text box for the chosen angle", () => {
    const rect = { x: 100, y: 200, w: 60, h: 20 };
    expect(boxForDrawnRect(rect, 0)).toEqual({ cx: 130, cy: 210, w: 60, h: 20, angle: 0 });
    const up = boxForDrawnRect({ x: 100, y: 200, w: 20, h: 60 }, -90);
    close(up.w, 60);
    close(up.h, 20);
    expect(up.angle).toBe(-90);
    const turned = boxForDrawnRect(rect, 58);
    const c = Math.cos((58 * Math.PI) / 180);
    const s = Math.sin((58 * Math.PI) / 180);
    close(turned.w, 60 * c + 20 * s);
    close(turned.h, 60 * s + 20 * c);
    expect(turned.angle).toBe(58);
  });
});

describe("detectionAt", () => {
  const det = (id: string, cx: number, cy: number, angle = 0) => ({
    id, box: { cx, cy, w: 0.02, h: 0.01 }, angle, readValue: "2.50", confidence: 90, source: "ocr" as const,
  });

  it("finds the value whose box holds the point, with a small margin", () => {
    const list = [det("a", 0.2, 0.3), det("b", 0.4, 0.3, -90)];
    expect(detectionAt(list, { x: 0.2 * 3300 + 20, y: 0.3 * 2550 }, 3300, 2550)?.id).toBe("a");
    expect(detectionAt(list, { x: 0.4 * 3300, y: 0.3 * 2550 + 25 }, 3300, 2550)?.id).toBe("b"); // along a vertical text
    expect(detectionAt(list, { x: 0.3 * 3300, y: 0.3 * 2550 }, 3300, 2550)).toBeNull();
  });

  it("reaches half the digit height beyond the box, and no further", () => {
    // "a" is 66 × 33 px: half-width 33, margin 16.5 along the text and across it.
    const list = [det("a", 0.2, 0.3), det("b", 0.4, 0.3, -90)];
    const a = { x: 0.2 * 3300, y: 0.3 * 2550 };
    expect(detectionAt(list, { x: a.x + 33 + 10, y: a.y }, 3300, 2550)?.id).toBe("a");
    expect(detectionAt(list, { x: a.x + 33 + 17, y: a.y }, 3300, 2550)).toBeNull();
    // across the vertical "b" (x is across its text): half-height 16.5 + margin 16.5
    const b = { x: 0.4 * 3300, y: 0.3 * 2550 };
    expect(detectionAt(list, { x: b.x + 30, y: b.y }, 3300, 2550)?.id).toBe("b");
    expect(detectionAt(list, { x: b.x + 34, y: b.y }, 3300, 2550)).toBeNull();
  });

  it("picks the nearer of two values whose margins overlap", () => {
    const list = [det("c", 0.2, 0.3), det("d", 0.2 + 70 / 3300, 0.3)];
    expect(detectionAt(list, { x: 0.2 * 3300 + 40, y: 0.3 * 2550 }, 3300, 2550)?.id).toBe("d");
  });
});
