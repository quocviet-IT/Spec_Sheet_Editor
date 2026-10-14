import { describe, expect, it, vi } from "vitest";
import { OcrFailure } from "@/lib/ocr/protocol";
import { orderClockwise, type Quad } from "@/lib/ocr/geometry";
import { createRaster, type Raster } from "@/lib/ocr/raster";
import type { ScanResult } from "@/lib/ocr/scan";
import type { PageTextItem } from "@/lib/page/text";
import { planEdit } from "@/editor/compose";
import {
  detectValues, drawnBox, fromPdfText, fromScan, makeEdit, ocrFailureReason, readingBox, signChoice, toDetection, type LoadedPage, type OcrLike,
} from "@/editor/detections";
import { axes, boxCorners, boxForDrawnRect } from "@/editor/geometry";
import { editSchema } from "@/editor/schema";

const W = 1100; // a small page with the template's ratio keeps the tests fast
const H = 850;

function ink(r: Raster, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * r.width + x) * 4;
    r.data[i] = 0x67; r.data[i + 1] = 0x66; r.data[i + 2] = 0x72;
  }
}

function page(): Raster {
  const r = createRaster(W, H);
  ink(r, 200, 200, 240, 212); // a horizontal value
  ink(r, 400, 300, 412, 340); // a vertical value
  return r;
}

const quad = (x0: number, y0: number, x1: number, y1: number): Quad => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

function scan(): ScanResult {
  return {
    detections: [
      { value: "2.50", prefix: "", text: "2.50", score: 0.87, angle: 0, quad: quad(190, 194, 250, 218), box: { x: 190, y: 194, w: 60, h: 24 } },
      { value: "6.90", prefix: "", text: "6.90", score: 0.9, angle: -90, quad: quad(396, 292, 416, 348), box: { x: 396, y: 292, w: 20, h: 56 } },
      { value: "5.75", prefix: "", text: "5.75", score: 0.99, angle: 0, quad: quad(880, 290, 920, 302), box: { x: 880, y: 290, w: 40, h: 12 } }, // right-hand table
    ],
    timing: { horizontalMs: 1, verticalMs: 1 },
  };
}

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const near = (a: number, b: number, eps = 0.6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe("fromScan", () => {
  it("keeps readings inside the drawing area, tightened to the digits", async () => {
    const found = await fromScan(scan(), page(), ids());
    expect(found.map((d) => d.readValue)).toEqual(["2.50", "6.90"]);
    const [h, v] = found;
    expect(h).toMatchObject({ id: "id-1", source: "ocr", confidence: 87, angle: 0 });
    near(h.box.cx * W, 220);
    near(h.box.cy * H, 206);
    near(h.box.w * W, 41);
    near(h.box.h * W, 13);
    expect(v).toMatchObject({ id: "id-2", source: "ocr", confidence: 90, angle: -90 });
    near(v.box.w * W, 41); // along the text, which runs up the page
    near(v.box.h * W, 13);
  });
});

/** A value at 30° around (300, 300): four blocks 12 px along and 13 px across, and a dimension line 4 px below them. */
function slantedPage(): Raster {
  const r = createRaster(W, H);
  const { u, v } = axes(30);
  for (let y = 150; y <= 450; y++) {
    for (let x = 150; x <= 450; x++) {
      const s = (x - 300) * u.x + (y - 300) * u.y;
      const t = (x - 300) * v.x + (y - 300) * v.y;
      const digit = Math.abs(s) < 30 && (s + 30) % 15 < 12 && Math.abs(t) < 6.5;
      const line = Math.abs(s) < 140 && t >= 10.5 && t < 12.5;
      if (digit || line) ink(r, x, y, x, y);
    }
  }
  return r;
}
/** The detector's quad around it: the text grown by 7 px on every side. */
const slantedQuad = orderClockwise(boxCorners({ cx: 300, cy: 300, w: 74, h: 27, angle: 30 }));

describe("readingBox (scan and click)", () => {
  it("makes a reading within 4° of an axis exactly that axis", () => {
    expect(readingBox(page(), { quad: quad(190, 194, 250, 218), angle: 2.5 }).angle).toBe(0);
    expect(readingBox(page(), { quad: quad(396, 292, 416, 348), angle: -87 }).angle).toBe(-90);
    expect(readingBox(page(), { quad: quad(190, 194, 250, 218), angle: -176.5 }).angle).toBe(180);
  });

  it("makes a value along an axis exact even when its quad is more than 4° off", () => {
    // 5.3° does not snap; the search lands at 0.3° or -0.2°, and that is made exactly 0.
    expect(readingBox(page(), { quad: quad(190, 194, 250, 218), angle: 5.3 }).angle).toBe(0);
  });

  it("keeps a free angle, turned to where the digits measure least tall, with the quad's box at that angle", () => {
    const px = readingBox(slantedPage(), { quad: slantedQuad, angle: 26 }); // the quad's own angle, a few degrees off
    near(px.angle, 30, 0.5);
    near(px.w, 74, 1);
    near(px.h, 27, 1);
  });

  it("stores the slanted value's angle and digit height through fromScan", async () => {
    const scan: ScanResult = {
      detections: [{ value: "1.20", prefix: "", text: "1.20", score: 0.9, angle: 26, quad: slantedQuad, box: { x: 0, y: 0, w: 0, h: 0 } }],
      timing: { horizontalMs: 1, verticalMs: 1 },
    };
    const [d] = await fromScan(scan, slantedPage(), ids());
    near(d.angle, 30, 0.5);
    near(d.box.h * W, 13, 1);
  });

  it("lets a waiting task run before fromScan searches a slanted value's angle, and not for upright ones or values outside the drawing", async () => {
    const reading = (quad: Quad) => ({ value: "1.20", prefix: "", text: "1.20", score: 0.9, angle: 26, quad, box: { x: 0, y: 0, w: 0, h: 0 } });
    const timing = { horizontalMs: 1, verticalMs: 1 };
    let ran = false;
    setTimeout(() => (ran = true), 0);
    await fromScan(scan(), page(), ids()); // 0° and -90° only
    // A slanted value in the right-hand table is left out before its angle is searched.
    const outside = orderClockwise(boxCorners({ cx: 900, cy: 300, w: 74, h: 27, angle: 30 }));
    expect(await fromScan({ detections: [reading(outside)], timing }, slantedPage(), ids())).toEqual([]);
    expect(ran).toBe(false);
    await fromScan({ detections: [reading(slantedQuad)], timing }, slantedPage(), ids());
    expect(ran).toBe(true);
  });
});

describe("drawnBox (UC-07)", () => {
  const rect = { x: 260, y: 270, w: 80, h: 60 }; // drawn around the 30° value

  it("keeps an axis choice exact, even around a slanted value", () => {
    const r = slantedPage();
    for (const angle of [0, 90, -90]) expect(drawnBox(r, rect, angle)).toEqual(boxForDrawnRect(rect, angle));
  });

  it("turns a free angle to where the digits measure least tall, covering the drawn rectangle at that angle", () => {
    const px = drawnBox(slantedPage(), rect, 27);
    near(px.angle, 30, 0.5);
    expect(px).toEqual(boxForDrawnRect(rect, px.angle));
  });

  it("leaves an empty rectangle at the chosen angle", () => {
    expect(drawnBox(createRaster(W, H), rect, 27)).toEqual(boxForDrawnRect(rect, 27));
  });
});

describe("fromPdfText", () => {
  it("turns text-layer values into stored detections", () => {
    // 6.90 at 9 pt and 300 DPI: font size 37.5 px, baseline start (300, 400), advance 70 px.
    const text: PageTextItem[] = [{ str: "6.90", transform: [37.5, 0, 0, -37.5, 300, 400], width: 70 }];
    const [d] = fromPdfText({ raster: createRaster(W, H), text, offsetX: 0, offsetY: 0, source: { kind: "image" } }, ids());
    expect(d).toMatchObject({ id: "id-1", readValue: "6.90", confidence: null, source: "pdf-text", angle: 0 });
    near(d.box.cx * W, 335); // blank page: nothing to tighten to, the text-layer box is kept
    near(d.box.cy * H, 386.5);
  });
});

describe("fromPdfText with ink on the page", () => {
  it("tightens the text-layer box to the ink", () => {
    // font 37.5 px, baseline start (190, 216), advance 70 px: a box 70 x 27 px, much larger than the 41 x 13 ink
    const text: PageTextItem[] = [{ str: "2.50", transform: [37.5, 0, 0, -37.5, 190, 216], width: 70 }];
    const [d] = fromPdfText({ raster: page(), text, offsetX: 0, offsetY: 0, source: { kind: "image" } }, ids());
    expect(d).toMatchObject({ readValue: "2.50", source: "pdf-text", angle: 0 });
    near(d.box.cx * W, 220);
    near(d.box.cy * H, 206);
    near(d.box.w * W, 41);
    near(d.box.h * W, 13);
  });
});

describe("ocrFailureReason", () => {
  it("tells a connection problem from a browser that cannot run the reader", () => {
    expect(ocrFailureReason(new OcrFailure("model_download", "x"))).toBe("ocr_load");
    expect(ocrFailureReason(new OcrFailure("runtime_download", "x"))).toBe("ocr_load");
    expect(ocrFailureReason(new OcrFailure("init_failed", "x"))).toBe("ocr_unsupported");
    expect(ocrFailureReason(new Error("Worker blocked"))).toBe("ocr_load");
  });
});

describe("detectValues", () => {
  const ready = (over: Partial<Record<"scan", unknown>> = {}) => {
    const reader = { scan: vi.fn(async () => scan()), ...over };
    return reader as unknown as OcrLike & typeof reader;
  };
  const loaded = (text: PageTextItem[] = []): LoadedPage => ({ raster: page(), text, offsetX: 0, offsetY: 0, source: { kind: "image" } });

  it("uses the text layer and never asks for the reader when it has values", async () => {
    const getReader = vi.fn(async () => ready());
    const text: PageTextItem[] = [{ str: "2.50", transform: [37.5, 0, 0, -37.5, 200, 212], width: 41 }];
    expect(await detectValues(loaded(text), getReader, ids())).toMatchObject({ ok: true, source: "pdf-text" });
    expect(getReader).not.toHaveBeenCalled();
  });

  it("scans the drawing area with the ready reader otherwise", async () => {
    const reader = ready();
    const result = await detectValues(loaded(), async () => reader, ids());
    expect(result).toMatchObject({ ok: true, source: "ocr" });
    expect(result.ok && result.detections).toHaveLength(2);
    expect(reader.scan).toHaveBeenCalledWith({ x: 51, y: 113, w: 686, h: 521 });
  });

  it("reports an empty list when the scan returns no values", async () => {
    const reader = ready({ scan: vi.fn(async () => ({ detections: [], timing: { horizontalMs: 1, verticalMs: 1 } })) });
    expect(await detectValues(loaded(), async () => reader, ids())).toEqual({ ok: true, source: "ocr", detections: [] });
    expect(reader.scan).toHaveBeenCalledTimes(1);
  });

  it("passes on why the reader could not start", async () => {
    const fail = (code: "model_download" | "init_failed") => async () => {
      throw new OcrFailure(code, "x");
    };
    expect(await detectValues(loaded(), fail("model_download"), ids())).toEqual({ ok: false, reason: "ocr_load" });
    expect(await detectValues(loaded(), fail("init_failed"), ids())).toEqual({ ok: false, reason: "ocr_unsupported" });
  });

  it("does not scan when the page was closed while the reader started", async () => {
    const reader = ready();
    expect(await detectValues(loaded(), async () => reader, ids(), () => true)).toEqual({ ok: false, reason: "cancelled" });
    expect(reader.scan).not.toHaveBeenCalled();
  });

  it("reports a scan that failed", async () => {
    const reader = ready({ scan: vi.fn(async () => { throw new Error("worker stopped"); }) });
    expect(await detectValues(loaded(), async () => reader, ids())).toEqual({ ok: false, reason: "ocr_scan" });
  });
});

describe("makeEdit", () => {
  it("measures the edit on the original page: tight box, digit height and colours", async () => {
    const [d] = await fromScan(scan(), page(), ids());
    const e = makeEdit(page(), d, "2.50", "2.60");
    expect(e).toMatchObject({ detectionId: d.id, oldValue: "2.50", newValue: "2.60", angle: 0, textColor: "#676672", bgColor: "#ffffff" });
    near(e.fontPx * W, 13);
    near(e.box.cx * W, 220);
  });

  it("measures a vertical value along its own axes", async () => {
    const [, d] = await fromScan(scan(), page(), ids());
    expect(d.angle).toBe(-90);
    const e = makeEdit(page(), d, "6.90", "6.80");
    expect(e).toMatchObject({ detectionId: d.id, angle: -90, textColor: "#676672", bgColor: "#ffffff" });
    near(e.fontPx * W, 13); // the digit height is the box height, across the text
    near(e.box.cx * W, 406);
    near(e.box.cy * H, 320);
    near(e.box.w * W, 41); // along the text, which runs up the page
    near(e.box.h * W, 13);
  });

  it("keeps the digit height when a line crosses the value, at detection and again at the edit", async () => {
    const r = page();
    ink(r, 196, 150, 197, 260); // an extension line through the horizontal value, far beyond its box
    const [d] = await fromScan(scan(), r, ids());
    near(d.box.h * W, 13);
    const e = makeEdit(r, d, "2.50", "2.60");
    near(e.fontPx * W, 13);
    near(e.box.h * W, 13);
  });

  it("falls back to the detection box and black on white when no text is found", async () => {
    const [d] = await fromScan(scan(), page(), ids());
    const e = makeEdit(createRaster(W, H), d, "2.50", "2.60");
    expect(e.box).toEqual(d.box);
    expect(e).toMatchObject({ textColor: "#000000", bgColor: "#ffffff" });
  });
});

describe("what is written in front of a value (Ø, R, 2X)", () => {
  const withPrefixes = (): ScanResult => {
    const s = scan();
    s.detections[0] = { ...s.detections[0], text: "Ø2.50", prefix: "Ø" };
    return s;
  };

  it("is kept from the scan, and left out of a value that has none", async () => {
    const [h, v] = await fromScan(withPrefixes(), page(), ids());
    expect(h).toMatchObject({ readValue: "2.50", prefix: "Ø" });
    expect("prefix" in v).toBe(false);
  });

  it("is carried to the edit, so it is drawn again in front of the new value", async () => {
    const [h, v] = await fromScan(withPrefixes(), page(), ids());
    expect(makeEdit(page(), h, "2.50", "2.60")).toMatchObject({ oldValue: "2.50", newValue: "2.60", prefix: "Ø" });
    expect("prefix" in makeEdit(page(), v, "6.90", "6.80")).toBe(false);
  });

  it("is kept for a value read by a click", () => {
    const px = { cx: 220, cy: 206, w: 60, h: 24, angle: 0 };
    expect(toDetection(page(), px, { readValue: "2.50", confidence: 90, source: "click", prefix: "2X Ø" }, ids())).toMatchObject({ prefix: "2X Ø" });
    expect("prefix" in toDetection(page(), px, { readValue: "2.50", confidence: 90, source: "click", prefix: "" }, ids())).toBe(false);
  });

  it("can be dropped when editing: the edit then has no prefix, and its box still covers the old sign", async () => {
    const [h] = await fromScan(withPrefixes(), page(), ids());
    const kept = makeEdit(page(), h, "2.50", "2.60");
    const dropped = makeEdit(page(), h, "2.50", "2.60", false);
    expect("prefix" in dropped).toBe(false);
    expect(dropped).toMatchObject({ oldValue: "2.50", newValue: "2.60" });
    // Only the drawn text changes: the mask is the same box as when the sign is kept.
    expect(dropped.box).toEqual(kept.box);
    expect(planEdit(dropped, W, H, 0.716).text).toBe("2.60");
    expect(planEdit(kept, W, H, 0.716).text).toBe("Ø2.60");
    expect(editSchema.safeParse(dropped).success).toBe(true);
  });

  it("is offered to keep or drop in the popover only when the machine read one", async () => {
    const [h, v] = await fromScan(withPrefixes(), page(), ids());
    expect(signChoice(h, null)).toEqual({ sign: "Ø", kept: true });
    expect(signChoice(h, makeEdit(page(), h, "2.50", "2.60"))).toEqual({ sign: "Ø", kept: true });
    // Reopened after the sign was dropped: still offered, now unchecked.
    expect(signChoice(h, makeEdit(page(), h, "2.50", "2.60", false))).toEqual({ sign: "Ø", kept: false });
    expect(signChoice(v, null)).toBeNull();
    expect(signChoice(v, makeEdit(page(), v, "6.90", "6.80"))).toBeNull();
  });
});
