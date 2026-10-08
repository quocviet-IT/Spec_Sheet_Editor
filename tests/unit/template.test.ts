import { describe, expect, it } from "vitest";
import { checkFile, MIB, mimeOf, ratioMatches, trimBounds } from "@/lib/form/template";
import { createRaster } from "@/lib/ocr/raster";

describe("checkFile (BR-01, TC-15, TC-16)", () => {
  it("accepts PDF, PNG and JPG by extension and type", () => {
    expect(checkFile({ name: "Sheet.PDF", size: 1000, type: "application/pdf" }, 20)).toEqual({ ok: true, sourceType: "pdf" });
    expect(checkFile({ name: "a.png", size: 1000, type: "image/png" }, 20)).toEqual({ ok: true, sourceType: "png" });
    expect(checkFile({ name: "a.jpeg", size: 1000, type: "image/jpeg" }, 20)).toEqual({ ok: true, sourceType: "jpg" });
    expect(checkFile({ name: "a.jpg", size: 1000, type: "image/jpg" }, 20)).toEqual({ ok: true, sourceType: "jpg" });
    expect(checkFile({ name: "a.pdf", size: 1000, type: "application/x-pdf" }, 20)).toEqual({ ok: true, sourceType: "pdf" });
    expect(checkFile({ name: "a.png", size: 1000, type: "image/jpg" }, 20)).toEqual({ ok: false, reason: "wrong_type" });
    expect(checkFile({ name: "a.jpg", size: 1000, type: "" }, 20)).toEqual({ ok: true, sourceType: "jpg" });
  });

  it("refuses other types, and a known extension with a contradicting type", () => {
    expect(checkFile({ name: "a.docx", size: 1000, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, 20)).toEqual({ ok: false, reason: "wrong_type" });
    expect(checkFile({ name: "a.heic", size: 1000, type: "image/heic" }, 20)).toEqual({ ok: false, reason: "wrong_type" });
    expect(checkFile({ name: "a.pdf", size: 1000, type: "image/png" }, 20)).toEqual({ ok: false, reason: "wrong_type" });
    expect(checkFile({ name: "pdf", size: 1000, type: "" }, 20)).toEqual({ ok: false, reason: "wrong_type" });
  });

  it("refuses a file over the limit and reports its size rounded up", () => {
    expect(checkFile({ name: "a.pdf", size: 21 * MIB, type: "application/pdf" }, 20)).toEqual({ ok: false, reason: "too_large", sizeMb: 21 });
    expect(checkFile({ name: "a.pdf", size: 20 * MIB + 1, type: "application/pdf" }, 20)).toEqual({ ok: false, reason: "too_large", sizeMb: 21 });
    expect(checkFile({ name: "a.pdf", size: 20 * MIB, type: "application/pdf" }, 20).ok).toBe(true);
  });

  it("maps source types to the MIME type stored with the file", () => {
    expect(mimeOf("pdf")).toBe("application/pdf");
    expect(mimeOf("png")).toBe("image/png");
    expect(mimeOf("jpg")).toBe("image/jpeg");
  });
});

describe("ratioMatches (BR-01, TC-12, TC-14)", () => {
  it("accepts 1.268 and 1.320 and refuses 1.260 and 1.330 at 2 %", () => {
    expect(ratioMatches(1268, 1000, 2)).toBe(true);
    expect(ratioMatches(1260, 1000, 2)).toBe(false);
    expect(ratioMatches(1320, 1000, 2)).toBe(true);
    expect(ratioMatches(1330, 1000, 2)).toBe(false);
  });

  it("accepts the real page sizes and refuses a drawing-only crop or a portrait page", () => {
    expect(ratioMatches(3300, 2550, 2)).toBe(true);
    expect(ratioMatches(1135, 877, 2)).toBe(true);
    expect(ratioMatches(584, 434, 2)).toBe(false);
    expect(ratioMatches(2550, 3300, 2)).toBe(false);
  });
});

describe("trimBounds (UC-03 step 4, TC-13)", () => {
  function sheetWithBorder(w: number, h: number, border: number) {
    const r = createRaster(w + 2 * border, h + 2 * border, 255);
    // content: a dark frame exactly at the content's edges
    for (let y = border; y < border + h; y++) {
      for (let x = border; x < border + w; x++) {
        const edge = y === border || y === border + h - 1 || x === border || x === border + w - 1;
        if (!edge) continue;
        const i = (y * r.width + x) * 4;
        r.data[i] = r.data[i + 1] = r.data[i + 2] = 20;
      }
    }
    return r;
  }

  it("removes a 40 px white border so the ratio matches again", () => {
    const r = sheetWithBorder(1135, 877, 40);
    const b = trimBounds(r);
    expect(b).toEqual({ x: 40, y: 40, w: 1135, h: 877 });
    expect(ratioMatches(b.w, b.h, 2)).toBe(true);
  });

  it("a 150 px white border fails the ratio until it is trimmed", () => {
    const r = sheetWithBorder(1135, 877, 150);
    expect(ratioMatches(r.width, r.height, 2)).toBe(false);
    const b = trimBounds(r);
    expect(b).toEqual({ x: 150, y: 150, w: 1135, h: 877 });
    expect(ratioMatches(b.w, b.h, 2)).toBe(true);
  });

  it("treats light grey (luminance 250 or more) as paper", () => {
    const r = createRaster(10, 10, 251);
    const i = (5 * 10 + 5) * 4;
    r.data[i] = r.data[i + 1] = r.data[i + 2] = 249;
    expect(trimBounds(r)).toEqual({ x: 5, y: 5, w: 1, h: 1 });
  });

  it("keeps the whole page when there is nothing darker than paper", () => {
    expect(trimBounds(createRaster(8, 6, 255))).toEqual({ x: 0, y: 0, w: 8, h: 6 });
  });
});
