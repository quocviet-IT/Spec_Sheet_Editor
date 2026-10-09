import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { PNG } from "pngjs";

/** The template's frames (header, four panels, right table) and title on one US Letter landscape page. */
function drawTemplate(page: PDFPage) {
  const frame = (x: number, y: number, w: number, h: number) =>
    page.drawRectangle({ x, y: 612 - y - h, width: w, height: h, borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 1 });
  frame(0.5, 0.5, 791, 611); // outer frame touching the page edge, so trimming keeps the full page
  frame(14, 10, 764, 40);
  frame(14, 58, 490, 540);
  frame(511, 58, 267, 540);
  page.drawText("PRODUCT SPECIFICATIONS", { x: 26, y: 612 - 38, size: 15 });
}

/** A synthetic sheet: US Letter landscape with the template's frames (header, four panels, right table). */
export async function templatePdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let p = 0; p < pages; p++) drawTemplate(doc.addPage([792, 612]));
  return Buffer.from(await doc.save());
}

/** A synthetic PNG: white with a dark frame at its very edges (so trimming keeps the full size). */
export function framedPng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
      const i = (y * width + x) * 4;
      const v = edge ? 30 : 255;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** A value printed on a synthetic sheet: its digits' centre as page fractions, read at `angle` (app convention). */
export type PlacedValue = { value: string; cx: number; cy: number; angle: number };

/** Eleven values on the four drawing panels: three read bottom-up, one top-down, two of them 2.50 (section 2.3). */
export const PDF_VALUES: readonly PlacedValue[] = [
  { value: "6.90", cx: 0.12, cy: 0.2, angle: 0 },
  { value: "16.30", cx: 0.25, cy: 0.3, angle: 0 },
  { value: "2.50", cx: 0.08, cy: 0.36, angle: -90 },
  { value: "1.50", cx: 0.42, cy: 0.22, angle: 0 },
  { value: "1.80", cx: 0.52, cy: 0.32, angle: -90 },
  { value: "10.29", cx: 0.58, cy: 0.2, angle: 0 },
  { value: "7.05", cx: 0.15, cy: 0.52, angle: 0 },
  { value: "4.66", cx: 0.28, cy: 0.62, angle: 90 },
  { value: "2.50", cx: 0.1, cy: 0.68, angle: 0 },
  { value: "1.20", cx: 0.45, cy: 0.55, angle: -90 },
  { value: "1.70", cx: 0.56, cy: 0.66, angle: 0 },
];

/** Values outside the drawing: the right-hand table and the bottom boxes (TC-23). */
export const OUTSIDE_VALUES: readonly PlacedValue[] = [
  { value: "5.75", cx: 0.8, cy: 0.3, angle: 0 },
  { value: "3.39", cx: 0.2, cy: 0.85, angle: 0 },
];

const INK = rgb(0x67 / 255, 0x66 / 255, 0x72 / 255);
const VALUE_PT = 9;
/** Helvetica digits stand about 0.72 em tall; the same share the app uses for text-layer boxes. */
const DIGIT_EM = 0.72;

function drawValue(page: PDFPage, font: PDFFont, v: PlacedValue) {
  const length = font.widthOfTextAtSize(v.value, VALUE_PT);
  const capH = DIGIT_EM * VALUE_PT;
  const r = -v.angle; // PDF angles turn counter-clockwise with y up
  const rad = (r * Math.PI) / 180;
  const u = { x: Math.cos(rad), y: Math.sin(rad) };
  const up = { x: -Math.sin(rad), y: Math.cos(rad) };
  const x = v.cx * 792 - (length / 2) * u.x - (capH / 2) * up.x;
  const y = 612 - v.cy * 612 - (length / 2) * u.y - (capH / 2) * up.y;
  page.drawText(v.value, { x, y, size: VALUE_PT, font, color: INK, rotate: degrees(r) });
}

const DIM_VALUE = PDF_VALUES.find((v) => v.value === "16.30")!;
const DIM_BASELINE_PT = 612 - DIM_VALUE.cy * 612 - (DIGIT_EM * VALUE_PT) / 2; // PDF y of the value's baseline
const DIM_Y_PT = DIM_BASELINE_PT - 2; // 2 pt under the baseline
const DIM_THICK_PT = 0.5;
const DIM_HALF_LENGTH_PT = 30;
const PX_PER_PT = 300 / 72;

/** The dimension line under 16.30 in pixels of the 300-DPI page (3300 x 2550), grown by 2 px on each side. */
export const DIMENSION_LINE_PX = {
  x: (DIM_VALUE.cx * 792 - DIM_HALF_LENGTH_PT) * PX_PER_PT - 2,
  y: (612 - DIM_Y_PT - DIM_THICK_PT / 2) * PX_PER_PT - 2,
  w: 2 * DIM_HALF_LENGTH_PT * PX_PER_PT + 4,
  h: DIM_THICK_PT * PX_PER_PT + 4,
};

/** The template with every value of PDF_VALUES and OUTSIDE_VALUES as real text, and an order number.
 *  With `asImage`, that one value (from PDF_VALUES) is drawn as the given 300-DPI image instead of text. */
export async function valuesPdf(options: { asImage?: { value: string; png: Buffer; width: number; height: number } } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([792, 612]);
  drawTemplate(page);
  page.drawText("SO 12345", { x: 600, y: 612 - 38, size: 11, font });
  page.drawLine({
    start: { x: DIM_VALUE.cx * 792 - DIM_HALF_LENGTH_PT, y: DIM_Y_PT },
    end: { x: DIM_VALUE.cx * 792 + DIM_HALF_LENGTH_PT, y: DIM_Y_PT },
    thickness: DIM_THICK_PT,
    color: INK,
  });
  const asImage = options.asImage;
  const imageValue = asImage ? PDF_VALUES.find((v) => v.value === asImage.value) : undefined;
  if (asImage && !imageValue) throw new Error(`${asImage.value} is not one of PDF_VALUES`);
  for (const v of [...PDF_VALUES, ...OUTSIDE_VALUES]) if (v !== imageValue) drawValue(page, font, v);
  if (asImage && imageValue) {
    const image = await doc.embedPng(asImage.png);
    const w = (asImage.width * 72) / 300;
    const h = (asImage.height * 72) / 300;
    page.drawImage(image, { x: imageValue.cx * 792 - w / 2, y: 612 - imageValue.cy * 612 - h / 2, width: w, height: h });
  }
  return Buffer.from(await doc.save());
}

/** Page 1 of a PDF file read in Node (pdfjs-dist, scale 1): page count, size in points and text items. */
export async function readPdf(path: string): Promise<{ pages: number; width: number; height: number; textItems: number }> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const view = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    return { pages: doc.numPages, width: view.width, height: view.height, textItems: text.items.length };
  } finally {
    await task.destroy(); // the loading task owns the document and the worker
  }
}

/** A PNG file decoded: size and RGBA bytes. */
export function readPng(path: string): { width: number; height: number; data: Buffer } {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: png.data };
}
