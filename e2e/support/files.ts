import { PDFDocument, rgb } from "pdf-lib";
import { PNG } from "pngjs";

/** A synthetic sheet: US Letter landscape with the template's frames (header, four panels, right table). */
export async function templatePdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([792, 612]);
    const frame = (x: number, y: number, w: number, h: number) =>
      page.drawRectangle({ x, y: 612 - y - h, width: w, height: h, borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 1 });
    frame(0.5, 0.5, 791, 611); // outer frame touching the page edge, so trimming keeps the full page
    frame(14, 10, 764, 40);
    frame(14, 58, 490, 540);
    frame(511, 58, 267, 540);
    page.drawText("PRODUCT SPECIFICATIONS", { x: 26, y: 612 - 38, size: 15 });
  }
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
