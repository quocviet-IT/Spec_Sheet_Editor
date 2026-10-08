import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees, type PDFFont, type PDFPage } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { exactDimension } from "@/lib/ocr/dimension-text";
import { multiply, toPageText, type PageTextItem } from "@/lib/page/text";
import { DIGIT_HEIGHT_EM, pdfTextValues } from "@/editor/pdf-text";

const SCALE = 300 / 72;
const SIZE = 9;

/** Draws `text` with its digits centred on (cx, cy) points from the top-left, read at `angle` (app convention). */
function drawCentred(page: PDFPage, font: PDFFont, text: string, cx: number, cy: number, angle: 0 | -90 | 90) {
  const length = font.widthOfTextAtSize(text, SIZE);
  const capH = DIGIT_HEIGHT_EM * SIZE;
  const r = -angle; // PDF angles turn counter-clockwise with y up
  const rad = (r * Math.PI) / 180;
  const u = { x: Math.cos(rad), y: Math.sin(rad) };
  const up = { x: -Math.sin(rad), y: Math.cos(rad) };
  const x = cx - (length / 2) * u.x - (capH / 2) * up.x;
  const y = 612 - cy - (length / 2) * u.y - (capH / 2) * up.y;
  page.drawText(text, { x, y, size: SIZE, font, rotate: degrees(r) });
}

async function textOf(draw: (page: PDFPage, font: PDFFont) => void): Promise<PageTextItem[]> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  draw(doc.addPage([792, 612]), font);
  const task = getDocument({ data: await doc.save(), verbosity: 0 });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: SCALE });
    const content = await page.getTextContent();
    return toPageText(content.items, viewport.transform, viewport.scale);
  } finally {
    await task.destroy();
  }
}

const FULL = { offsetX: 0, offsetY: 0, width: 3300, height: 2550 };
const near = (a: number, b: number, eps: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe("exactDimension", () => {
  it("takes text-layer strings as written", () => {
    expect(exactDimension("2.50")).toBe("2.50");
    expect(exactDimension("R1.20")).toBe("1.20");
    expect(exactDimension("16,30")).toBe("16.30");
    expect(exactDimension("1630")).toBeNull(); // no decimal point is inserted for the text layer
    expect(exactDimension("SO 12345")).toBeNull();
    expect(exactDimension("0.00")).toBeNull();
  });
});

describe("multiply", () => {
  it("applies the second matrix first, like pdf.js Util.transform", () => {
    expect(multiply([2, 0, 0, -2, 0, 100], [1, 0, 0, 1, 10, 20])).toEqual([2, 0, 0, -2, 20, 60]);
  });
});

describe("pdfTextValues on real pdf.js output", () => {
  it("finds horizontal and vertical values with their angles and centres", async () => {
    const items = await textOf((page, font) => {
      drawCentred(page, font, "2.50", 200, 200, 0);
      drawCentred(page, font, "6.90", 300, 250, -90);
      drawCentred(page, font, "1.20", 400, 300, 90);
    });
    const values = pdfTextValues(items, FULL);
    expect(values.map((v) => v.value)).toEqual(["2.50", "6.90", "1.20"]);
    const [h, up, down] = values;
    expect(h.px.angle).toBe(0);
    expect(up.px.angle).toBe(-90);
    expect(down.px.angle).toBe(90);
    for (const [v, cx, cy] of [[h, 200, 200], [up, 300, 250], [down, 400, 300]] as const) {
      near(v.px.cx, cx * SCALE, 1);
      near(v.px.cy, cy * SCALE, 1);
      near(v.px.h, DIGIT_HEIGHT_EM * SIZE * SCALE, 0.5);
    }
    near(h.px.w, 1.946 * SIZE * SCALE, 0.5); // Helvetica "2.50" advances 1946 / 1000 em
  });

  it("skips values outside the drawing area and strings that are not dimensions", async () => {
    const items = await textOf((page, font) => {
      drawCentred(page, font, "5.75", 0.8 * 792, 0.3 * 612, 0); // right-hand table
      drawCentred(page, font, "3.39", 0.2 * 792, 0.85 * 612, 0); // bottom boxes
      drawCentred(page, font, "1630", 200, 200, 0);
      page.drawText("SO 12345", { x: 200, y: 400, size: SIZE, font });
    });
    expect(pdfTextValues(items, FULL)).toEqual([]);
  });

  it("subtracts the trim offset", async () => {
    const items = await textOf((page, font) => drawCentred(page, font, "2.50", 200, 200, 0));
    const [v] = pdfTextValues(items, { offsetX: 10, offsetY: 20, width: 3280, height: 2530 });
    near(v.px.cx, 200 * SCALE - 10, 1);
    near(v.px.cy, 200 * SCALE - 20, 1);
  });

  it("keeps one value when the same run is printed twice at the same place", async () => {
    const items = await textOf((page, font) => {
      drawCentred(page, font, "2.50", 200, 200, 0);
      drawCentred(page, font, "2.50", 200.2, 200.1, 0);
    });
    expect(pdfTextValues(items, FULL)).toHaveLength(1);
  });
});
