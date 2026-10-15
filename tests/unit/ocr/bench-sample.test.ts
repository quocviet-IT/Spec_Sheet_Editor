import { describe, expect, it } from "vitest";
import { drawingAreaPx, edgeMarginPx } from "@/editor/geometry";
import { editorView, SAMPLE_SIZE, SAMPLE_TRUTH } from "@/lib/ocr/bench/sample";
import { createRaster, type Raster } from "@/lib/ocr/raster";

/** A sheet-sized image with a dark frame drawn around a box: the ink the editor trims the page to. */
function sampleWithFrame(x: number, y: number, w: number, h: number): Raster {
  const r = createRaster(SAMPLE_SIZE.width, SAMPLE_SIZE.height);
  const dark = (px: number, py: number) => r.data.fill(0, (py * r.width + px) * 4, (py * r.width + px) * 4 + 3);
  for (let i = x; i < x + w; i++) {
    dark(i, y);
    dark(i, y + h - 1);
  }
  for (let j = y; j < y + h; j++) {
    dark(x, j);
    dark(x + w - 1, j);
  }
  return r;
}

describe("editorView (the bench measures what the editor scans)", () => {
  it("scans the drawing area of the page the editor holds, and the margin around it, not a frame set by hand", () => {
    const view = editorView(createRaster(SAMPLE_SIZE.width, SAMPLE_SIZE.height));
    expect([view.page.width, view.page.height]).toEqual([SAMPLE_SIZE.width, SAMPLE_SIZE.height]);
    expect(view.frame).toEqual(drawingAreaPx(SAMPLE_SIZE.width, SAMPLE_SIZE.height));
    expect(view.frame).toEqual({ x: 52, y: 117, w: 708, h: 537 });
    expect(view.margin).toBe(edgeMarginPx(SAMPLE_SIZE.width));
    expect(view.margin).toBe(23);
    expect(view.truth).toEqual(SAMPLE_TRUTH);
  });

  it("trims the sample to its page as the editor does, and moves the truth onto that page", () => {
    // A frame of the template's ratio (1000 / 773 ≈ 1.294) is the page itself.
    const view = editorView(sampleWithFrame(40, 30, 1000, 773));
    expect([view.page.width, view.page.height]).toEqual([1000, 773]);
    expect(view.offset).toEqual({ x: 40, y: 30 });
    expect(view.frame).toEqual(drawingAreaPx(1000, 773));
    expect(view.truth[0]).toEqual({ ...SAMPLE_TRUTH[0], x: SAMPLE_TRUTH[0].x - 40, y: SAMPLE_TRUTH[0].y - 30 });
    expect(view.truth.map((t) => t.key)).toEqual(SAMPLE_TRUTH.map((t) => t.key));
  });
});
