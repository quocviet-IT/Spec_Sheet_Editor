import { describe, expect, it, vi } from "vitest";
import { OcrFailure } from "@/lib/ocr/protocol";
import type { Quad } from "@/lib/ocr/geometry";
import { createRaster, type Raster } from "@/lib/ocr/raster";
import type { ScanResult } from "@/lib/ocr/scan";
import type { PageTextItem } from "@/lib/page/text";
import { detectValues, fromPdfText, fromScan, makeEdit, ocrFailureReason, type LoadedPage, type OcrLike } from "@/editor/detections";

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
      { value: "2.50", text: "2.50", score: 0.87, angle: 0, quad: quad(190, 194, 250, 218), box: { x: 190, y: 194, w: 60, h: 24 } },
      { value: "6.90", text: "6.90", score: 0.9, angle: -90, quad: quad(396, 292, 416, 348), box: { x: 396, y: 292, w: 20, h: 56 } },
      { value: "5.75", text: "5.75", score: 0.99, angle: 0, quad: quad(880, 290, 920, 302), box: { x: 880, y: 290, w: 40, h: 12 } }, // right-hand table
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
  it("keeps readings inside the drawing area, tightened to the digits", () => {
    const found = fromScan(scan(), page(), ids());
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
  it("measures the edit on the original page: tight box, digit height and colours", () => {
    const [d] = fromScan(scan(), page(), ids());
    const e = makeEdit(page(), d, "2.50", "2.60");
    expect(e).toMatchObject({ detectionId: d.id, oldValue: "2.50", newValue: "2.60", angle: 0, textColor: "#676672", bgColor: "#ffffff" });
    near(e.fontPx * W, 13);
    near(e.box.cx * W, 220);
  });

  it("falls back to the detection box and black on white when no text is found", () => {
    const [d] = fromScan(scan(), page(), ids());
    const e = makeEdit(createRaster(W, H), d, "2.50", "2.60");
    expect(e.box).toEqual(d.box);
    expect(e).toMatchObject({ textColor: "#000000", bgColor: "#ffffff" });
  });
});
