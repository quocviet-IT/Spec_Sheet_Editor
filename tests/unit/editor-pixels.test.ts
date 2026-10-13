import { describe, expect, it } from "vitest";
import { normalizeAngle, orderClockwise } from "@/lib/ocr/geometry";
import { createRaster, rotate90cw, type Raster } from "@/lib/ocr/raster";
import { axes, boxCorners, boxForDrawnRect, boxFromQuad } from "@/editor/geometry";
import { analyseBox, refineAngle } from "@/editor/pixels";

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

describe("analyseBox: ink that runs out of the search window is drawing, not digits", () => {
  const RED: [number, number, number] = [0xd0, 0x20, 0x20];
  const METAL: [number, number, number] = [0x10, 0x40, 0x30]; // darker than the red digits
  const box = { cx: 129, cy: 64, w: 80, h: 30, angle: 0 };

  /** The scene's digits in red, with two extension lines crossing the whole page through the value's box. */
  function extensionLines(): Raster {
    const r = scene();
    for (const x0 of [100, 114, 134, 148]) fill(r, x0, 50, x0 + 10, 69, RED);
    fill(r, 128, 67, 130, 69, RED);
    fill(r, 96, 0, 97, 149, RED);
    fill(r, 161, 0, 162, 149, RED);
    return r;
  }

  /** The red digits under a ring shank that comes down from the top of the page and touches two of them. */
  function shank(): Raster {
    const r = extensionLines();
    fill(r, 96, 0, 97, 149, [255, 255, 255]);
    fill(r, 161, 0, 162, 149, [255, 255, 255]);
    fill(r, 120, 0, 135, 49, METAL);
    return r;
  }

  it("measures the digit height when lines cross the box", () => {
    const { tight } = analyseBox(extensionLines(), box)!;
    expect(tight.h).toBe(20);
    near(tight.cy, 59.5);
    near(tight.cx, 129);
    expect(tight.w).toBeGreaterThanOrEqual(59);
  });

  it("measures the digit height and keeps the digits' colour under a darker shank that touches them", () => {
    const result = analyseBox(shank(), box)!;
    expect(result.tight.h).toBe(20);
    near(result.tight.cy, 59.5);
    expect(result.textColor).toBe("#d02020");
  });

  it("does the same for vertical text", () => {
    // Turned clockwise, (x, y) moves to (149 - y, x): the text now reads top-down (angle 90).
    const result = analyseBox(rotate90cw(shank()), { cx: 85, cy: 129, w: 80, h: 30, angle: 90 })!;
    expect(result.tight.h).toBe(20);
    near(result.tight.cx, 89.5);
    expect(result.textColor).toBe("#d02020");
  });

  it("does not grow when its own tight box is measured again", () => {
    for (const page of [extensionLines(), shank()]) {
      const once = analyseBox(page, box)!.tight;
      const twice = analyseBox(page, once)!.tight;
      expect(twice.h).toBe(once.h);
      near(twice.cy, once.cy);
    }
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

describe("refineAngle", () => {
  /**
   * A value at `angle` (30° unless said) around (150, 100): four digit blocks 12 px along the text and 13 px
   * across, 3 px apart, and (unless left out) a dimension line 2 px thick, 4 px below the digits, that runs
   * on well beyond them.
   */
  function slanted(angle = 30, withLine = true): Raster {
    const r = createRaster(300, 200);
    const { u, v } = axes(angle);
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const s = (x - 150) * u.x + (y - 100) * u.y;
        const t = (x - 150) * v.x + (y - 100) * v.y;
        const digit = Math.abs(s) < 30 && (s + 30) % 15 < 12 && Math.abs(t) < 6.5;
        const line = withLine && Math.abs(s) < 140 && t >= 10.5 && t < 12.5;
        if (digit || line) fill(r, x, y, x, y, INK);
      }
    }
    return r;
  }
  /** The detector's quad around that value: the text grown by 7 px on every side. */
  const quadAt = (angle: number) => orderClockwise(boxCorners({ cx: 150, cy: 100, w: 74, h: 27, angle }));
  const quad = quadAt(30);

  it("turns a box given at 25° to the value's own 30°, tightened to the digits there", () => {
    const result = refineAngle(slanted(), boxFromQuad(quad, 25));
    near(result.angle, 30, 0.5);
    near(result.h, 13, 1);
  });

  it("turns a box given at 25° to 30° on a clean value too, with no line beside it", () => {
    const result = refineAngle(slanted(30, false), boxFromQuad(quad, 25));
    near(result.angle, 30, 0.5);
    near(result.h, 13, 1);
  });

  it("finds the same angle from the other side", () => {
    near(refineAngle(slanted(), boxFromQuad(quad, 35)).angle, 30, 0.5);
  });

  /** How far apart two angles are, across the ±180° seam. */
  const apart = (a: number, b: number) => Math.abs(normalizeAngle(a - b));

  it("finds a value's angle below 0°", () => {
    expect(apart(refineAngle(slanted(-40), boxFromQuad(quadAt(-40), -35)).angle, -40)).toBeLessThanOrEqual(0.5);
  });

  it("finds a value's angle near 180°, on either side of the ±180° seam", () => {
    expect(apart(refineAngle(slanted(170), boxFromQuad(quadAt(170), 175)).angle, 170)).toBeLessThanOrEqual(0.5);
    // Up from 178° the steps pass 180° and go on at -179.5°, -179°, … to the value's -175°.
    const across = refineAngle(slanted(-175), boxFromQuad(quadAt(-175), 178));
    expect(apart(across.angle, -175)).toBeLessThanOrEqual(0.5);
    expect(across.angle).toBeLessThan(0); // normalised, never 185
    near(across.h, 13, 1);
  });

  it("leaves a box along the page's axes alone, even on a slanted value", () => {
    const r = slanted();
    for (const angle of [0, 90, -90, 180]) {
      const box = { cx: 150, cy: 100, w: 74, h: 27, angle };
      expect(refineAngle(r, box)).toBe(box);
    }
  });

  it("does not turn when no angle measures at least 1 px less tall", () => {
    const atValue = refineAngle(slanted(), boxFromQuad(quad, 30));
    expect(atValue.angle).toBe(30);
    near(atValue.h, 13, 1);
    // A round mark has no direction: it measures as tall at every angle.
    const dot = createRaster(300, 200);
    for (let y = 85; y <= 115; y++) for (let x = 135; x <= 165; x++) if (Math.hypot(x - 150, y - 100) <= 10) fill(dot, x, y, x, y, INK);
    expect(refineAngle(dot, { cx: 150, cy: 100, w: 40, h: 30, angle: 30 }).angle).toBe(30);
  });

  it("returns a box that holds no text unchanged", () => {
    const box = { cx: 150, cy: 100, w: 74, h: 27, angle: 30 };
    expect(refineAngle(createRaster(300, 200), box)).toBe(box);
  });

  it("keeps the given angle when the least height lies at the end of the range, for a long box or a square one", () => {
    // Given 15° off, the digits measure less and less tall up to 27°, the end of the ±12° range. Nothing is
    // measured beyond it, so no wall shows the valley there: the search would only be drifting.
    expect(refineAngle(slanted(), { cx: 150, cy: 100, w: 74, h: 27, angle: 15 }).angle).toBe(15);
    expect(refineAngle(slanted(), { cx: 150, cy: 100, w: 74, h: 60, angle: 15 }).angle).toBe(15);
  });

  /**
   * A short "1.20"-like value at 150° around (150.5, 100.25) that a dimension line touches: the "2" and the
   * "0" reach down to the line, so they go with it as ink reaching the window's edge, and only the narrow
   * "1", clear of the line, is measured. Its height hardly changes with the angle: 14 px at nearly every
   * step, with a 13 here and there from whole pixels alone.
   */
  function touched(): Raster {
    const r = createRaster(300, 200);
    const { u, v } = axes(150);
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const s = (x - 150.5) * u.x + (y - 100.25) * u.y;
        const t = (x - 150.5) * v.x + (y - 100.25) * v.y;
        const one = s >= -19 && s < -16 && t >= -7.3 && t < 6.5;
        const twoAndZero = ((s >= -12 && s < -1) || (s >= 3 && s < 14)) && t >= -6.5 && t < 8;
        const line = Math.abs(s) < 140 && t >= 8 && t < 10;
        if (one || twoAndZero || line) fill(r, x, y, x, y, INK);
      }
    }
    return r;
  }
  /** The detector's quad around it at the given angle, on whole pixels. */
  const touchedQuad = (angle: number) =>
    orderClockwise(boxCorners({ cx: 150.5, cy: 100.25, w: 48, h: 27, angle }).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })));

  it("keeps the given angle on a short value a line touches, where a 1-px dip far off is noise", () => {
    // Given 2.5° off, the 13-px steps lie 9.5° and 10° away with no wall beside them: taking them would
    // end 12° and 7.5° off the value's 150°, farther than the given angle.
    const r = touched();
    for (const given of [147.5, 152.5]) expect(refineAngle(r, boxFromQuad(touchedQuad(given), given)).angle).toBe(given);
    // A rectangle drawn around it at a typed angle: the dips would take 148° to 137° and 154° to 166°.
    const rect = { x: 120, y: 75, w: 60, h: 50 };
    for (const typed of [148, 154]) expect(refineAngle(r, boxForDrawnRect(rect, typed)).angle).toBe(typed);
  });
});
