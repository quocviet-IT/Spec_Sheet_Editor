import { describe, expect, it } from "vitest";
import { DRAWING_AREA } from "@/lib/form/template";
import { normalizeAngle, orderClockwise, type Quad } from "@/lib/ocr/geometry";
import { createRaster, cropQuad, cropTurnsQuarter } from "@/lib/ocr/raster";
import {
  angleFromQuad, axes, boxCorners, boxForDrawnRect, boxFromQuad, centreInDrawingArea, detectionAt, drawingAreaPx,
  isAxisAngle, nearestAxis, panelOf, pointInDrawingArea, readingOrder, rectFromDrag, rectInDrawingArea, roundAngle, roundBox,
  sameSize, snapAngle, toBox, toPx,
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
    const box = boxFromQuad(quad, 0);
    close(box.cx, 130); close(box.cy, 60); close(box.w, 60); close(box.h, 20);
    expect(box.angle).toBe(0);
  });

  it("does not depend on the corner order (the detector's order is not the text's)", () => {
    const quad: Quad = [{ x: 160, y: 70 }, { x: 100, y: 70 }, { x: 100, y: 50 }, { x: 160, y: 50 }];
    const box = boxFromQuad(quad, 0);
    close(box.cx, 130); close(box.cy, 60); close(box.w, 60); close(box.h, 20);
    expect(box.angle).toBe(0);
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

describe("angleFromQuad", () => {
  const sameAngle = (a: number, b: number) => close(normalizeAngle(a - b), 0, 1e-6);

  /**
   * A value written at `angle` as the detector and the reader see it: a 74 × 27 box (the text grown by the
   * detector's margin) whose only ink is a mark at the start of the text, at the top of the digits. The
   * detector orders the corners (orderClockwise); cropQuad straightens the box; the reader reads the crop as
   * it is when the mark lands top left, and upside down when it lands bottom right.
   */
  function seen(angle: number): { quad: Quad; turn: 0 | 90 | 180 | 270 } {
    const raster = createRaster(300, 300);
    const { u, v } = axes(angle);
    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 300; x++) {
        const s = (x - 150) * u.x + (y - 150) * u.y;
        const t = (x - 150) * v.x + (y - 150) * v.y;
        if (s < -37 || s >= -22 || t < -13.5 || t >= -5.5) continue;
        raster.data.fill(0, (y * 300 + x) * 4, (y * 300 + x) * 4 + 3);
      }
    }
    const quad = orderClockwise(boxCorners({ cx: 150, cy: 150, w: 74, h: 27, angle }));
    const crop = cropQuad(raster, quad);
    let n = 0;
    let mx = 0;
    let my = 0;
    for (let y = 0; y < crop.height; y++) {
      for (let x = 0; x < crop.width; x++) {
        if (crop.data[(y * crop.width + x) * 4] > 128) continue;
        n++;
        mx += x;
        my += y;
      }
    }
    expect(n).toBeGreaterThan(0);
    const left = mx / n < crop.width / 2;
    const top = my / n < crop.height / 2;
    expect(left).toBe(top); // never sideways: the crop's long side runs along the text
    return { quad, turn: ((cropTurnsQuarter(quad) ? 90 : 0) + (top ? 0 : 180)) as 0 | 90 | 180 | 270 };
  }

  it.each([0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90, 180])(
    "gives back a value written at %i° from the detector's corners and the reader's turn",
    (angle) => {
      const { quad, turn } = seen(angle);
      sameAngle(angleFromQuad(quad, turn, 0), angle);
    },
  );

  it("reads along tl → tr for a crop read as it is, along tl → bl for a tall one, and adds 180° upside down", () => {
    expect(seen(30).turn).toBe(0);
    expect(seen(75).turn).toBe(90); // the crop is tall: turned a quarter, its text runs tl → bl
    expect(seen(180).turn).toBe(180); // the same quad as at 0°, read upside down
    expect(seen(-90).turn).toBe(270); // the same quad as at 90°, read upside down: bottom-up
    const flat: Quad = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 0, y: 10 }];
    const tall: Quad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 40 }, { x: 0, y: 40 }];
    expect(angleFromQuad(flat, 0, 0)).toBe(0);
    expect(angleFromQuad(flat, 180, 0)).toBe(180);
    expect(angleFromQuad(tall, 90, 0)).toBe(90);
    expect(angleFromQuad(tall, 270, 0)).toBe(-90);
  });

  it("adds the turn of the image that was read, exactly for a quad along its axes", () => {
    const flat: Quad = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 0, y: 10 }];
    const tall: Quad = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 40 }, { x: 0, y: 40 }];
    expect(angleFromQuad(flat, 0, -90)).toBe(-90); // the scan's clockwise pass
    expect(angleFromQuad(flat, 180, -90)).toBe(90);
    expect(angleFromQuad(tall, 270, -90)).toBe(180);
    expect(angleFromQuad(flat, 0, 60)).toBe(60); // a click image turned 60° counter-clockwise
    expect(angleFromQuad(flat, 180, 90)).toBe(-90);
  });

  it("gives the same angle from the quad in a turned image as from that quad mapped back to the page", () => {
    // The scan's second pass reads the page turned a quarter clockwise: its pixel (x, y) is the page's (y, 299 - x).
    const { quad, turn } = seen(20);
    const onPage = quad.map((p) => ({ x: p.y, y: 299 - p.x })) as Quad;
    sameAngle(angleFromQuad(quad, turn, -90), -70);
    sameAngle(angleFromQuad(onPage, turn, 0), -70);
  });
});

describe("snapAngle", () => {
  it("gives exactly 0, 90, -90 or 180 within 4°, and the angle itself otherwise", () => {
    expect(snapAngle(3.9)).toBe(0);
    expect(snapAngle(4.1)).toBe(4.1);
    expect(snapAngle(86)).toBe(90);
    expect(snapAngle(-177)).toBe(180);
    expect(snapAngle(-86.5)).toBe(-90);
    expect(snapAngle(183)).toBe(180);
    expect(snapAngle(30)).toBe(30);
    expect(snapAngle(-45)).toBe(-45);
    expect(Object.is(snapAngle(-0.5), 0)).toBe(true); // never -0
  });

  it("normalises an angle it does not snap, and takes another tolerance", () => {
    expect(snapAngle(200)).toBe(-160);
    expect(snapAngle(5, 6)).toBe(0);
    expect(snapAngle(5, 4)).toBe(5);
  });
});

describe("nearestAxis", () => {
  it("gives exactly 0, 90, -90 or 180, never -0 or -180", () => {
    expect(nearestAxis(6)).toBe(0);
    expect(Object.is(nearestAxis(-6), 0)).toBe(true);
    expect(nearestAxis(-98)).toBe(-90);
    expect(nearestAxis(-77.3)).toBe(-90);
    expect(nearestAxis(98)).toBe(90);
    expect(nearestAxis(174)).toBe(180);
    expect(nearestAxis(-174)).toBe(180);
    expect(nearestAxis(366)).toBe(0);
  });
});

describe("isAxisAngle", () => {
  it("is true only for exactly 0, 90, -90 and 180", () => {
    for (const a of [0, 90, -90, 180, -180, 270]) expect(isAxisAngle(a)).toBe(true);
    for (const a of [0.01, 30, -45, 89.99, 179.5]) expect(isAxisAngle(a)).toBe(false);
  });
});

describe("fractions and pixels", () => {
  it("measures both sizes against the page width", () => {
    const box = toBox({ cx: 1650, cy: 1275, w: 66, h: 33, angle: -90 }, 3300, 2550);
    close(box.cx, 0.5); close(box.cy, 0.5); close(box.w, 0.02); close(box.h, 0.01);
    const back = toPx(box, -90, 3300, 2550);
    close(back.cx, 1650); close(back.cy, 1275); close(back.w, 66); close(back.h, 33);
    expect(back.angle).toBe(-90);
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

  it("accepts a rectangle exactly on the four edges of the drawing area", () => {
    const W = 3300;
    const H = 2550;
    const { x0, x1, y0, y1 } = DRAWING_AREA;
    // starts picked so that the sum x + w lands exactly on the right and bottom edges
    expect(rectInDrawingArea({ x: x0 * W, y: 600, w: 80, h: 30 }, W, H)).toBe(true);
    expect(rectInDrawingArea({ x: x0 * W - 0.01, y: 600, w: 80, h: 30 }, W, H)).toBe(false);
    expect(rectInDrawingArea({ x: 400, y: y0 * H, w: 80, h: 30 }, W, H)).toBe(true);
    expect(rectInDrawingArea({ x: 400, y: y0 * H - 0.01, w: 80, h: 30 }, W, H)).toBe(false);
    expect(rectInDrawingArea({ x: 1500, y: 600, w: x1 * W - 1500, h: 30 }, W, H)).toBe(true);
    expect(rectInDrawingArea({ x: 1500, y: 600, w: x1 * W - 1500 + 0.01, h: 30 }, W, H)).toBe(false);
    expect(rectInDrawingArea({ x: 400, y: 1200, w: 80, h: y1 * H - 1200 }, W, H)).toBe(true);
    expect(rectInDrawingArea({ x: 400, y: 1200, w: 80, h: y1 * H - 1200 + 0.01 }, W, H)).toBe(false);
  });

  it("counts a value centred exactly on an edge of the drawing area as inside (BR-02)", () => {
    const { x0, x1, y0, y1 } = DRAWING_AREA;
    const at = (cx: number, cy: number) => centreInDrawingArea({ cx, cy, w: 0.01, h: 0.005 });
    expect(at(x0, 0.3)).toBe(true);
    expect(at(x1, 0.3)).toBe(true);
    expect(at(0.3, y0)).toBe(true);
    expect(at(0.3, y1)).toBe(true);
    expect(at(x0 - 1e-9, 0.3)).toBe(false);
    expect(at(x1 + 1e-9, 0.3)).toBe(false);
    expect(at(0.3, y0 - 1e-9)).toBe(false);
    expect(at(0.3, y1 + 1e-9)).toBe(false);
  });

  it("knows whether a click lies inside the drawing", () => {
    expect(pointInDrawingArea({ x: 400, y: 600 }, 3300, 2550)).toBe(true);
    expect(pointInDrawingArea({ x: 2700, y: 600 }, 3300, 2550)).toBe(false);
  });

  it("takes the drawn rectangle as the text box for the chosen angle", () => {
    const rect = { x: 100, y: 200, w: 60, h: 20 };
    const flat = boxForDrawnRect(rect, 0);
    close(flat.cx, 130); close(flat.cy, 210); close(flat.w, 60); close(flat.h, 20);
    expect(flat.angle).toBe(0);
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

  it("at 58° the box covers the rectangle: all four corners of the rectangle lie inside the box", () => {
    const rect = { x: 100, y: 200, w: 60, h: 20 };
    const box = boxForDrawnRect(rect, 58);
    const { u, v } = axes(box.angle);
    const corners = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x + rect.w, rect.y + rect.h], [rect.x, rect.y + rect.h]];
    for (const [x, y] of corners) {
      const s = (x - box.cx) * u.x + (y - box.cy) * u.y;
      const t = (x - box.cx) * v.x + (y - box.cy) * v.y;
      expect(Math.abs(s)).toBeLessThanOrEqual(box.w / 2 + 1e-9);
      expect(Math.abs(t)).toBeLessThanOrEqual(box.h / 2 + 1e-9);
    }
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
