"use client";

import { crop, type Raster } from "@/lib/ocr/raster";
import { trimBounds, type SourceType } from "@/lib/form/template";
import { flattenOnWhite } from "./flatten";
import { orientationMatrix, orientedSize, readJpegOrientation } from "./orientation";
import { pdfErrorCode, type PdfError } from "./pdf-errors";

/** PDF page 1 at 300 DPI (a Letter page in points × 300 / 72): 3300 × 2550 px. */
const PDF_SCALE = 300 / 72;

export type RenderedPage = { raster: Raster; pageCount: number };

export class PageError extends Error {
  constructor(readonly code: PdfError | "image_unreadable") {
    super(code);
    this.name = "PageError";
  }
}

function canvasRaster(canvas: HTMLCanvasElement): Raster {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new PageError("image_unreadable");
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: image.data };
}

async function renderPdf(file: Blob): Promise<RenderedPage> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy();
    throw new PageError(pdfErrorCode(error));
  }
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: PDF_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new PageError("pdf_damaged");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // pdf.js 6 prefers `canvas`; `canvasContext` is only for backwards compatibility.
    await page.render({ canvas, viewport }).promise;
    return { raster: canvasRaster(canvas), pageCount: doc.numPages };
  } catch (error) {
    if (error instanceof PageError) throw error;
    throw new PageError("pdf_damaged");
  } finally {
    await task.destroy(); // pdf.js 6: the loading task owns the worker; the document proxy has no destroy()
  }
}

async function renderImage(file: Blob, sourceType: SourceType): Promise<RenderedPage> {
  let bitmap: ImageBitmap;
  try {
    // Orientation is applied below by our own code, so every browser sees the same pixels.
    bitmap = await createImageBitmap(file, { imageOrientation: "none" });
  } catch {
    throw new PageError("image_unreadable");
  }
  const orientation = sourceType === "jpg" ? readJpegOrientation(new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())) : 1;
  const size = orientedSize(bitmap.width, bitmap.height, orientation);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new PageError("image_unreadable");
  ctx.setTransform(...orientationMatrix(orientation, bitmap.width, bitmap.height));
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { raster: flattenOnWhite(canvasRaster(canvas)), pageCount: 1 };
}

/** The page as the app sees it: PDF page 1 at 300 DPI, or the upright image on white (UC-03 step 3). */
export function renderSource(file: Blob, sourceType: SourceType): Promise<RenderedPage> {
  return sourceType === "pdf" ? renderPdf(file) : renderImage(file, sourceType);
}

/** The page with its near-white borders removed (UC-03 step 4). */
export function trimPage(page: RenderedPage): Raster {
  const b = trimBounds(page.raster);
  if (b.x === 0 && b.y === 0 && b.w === page.raster.width && b.h === page.raster.height) return page.raster;
  return crop(page.raster, b);
}

export function drawRaster(canvas: HTMLCanvasElement, raster: Raster): void {
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
}

/** A 480-px-wide JPEG of the trimmed page (UC-03 step 5). */
export async function encodeThumbnail(raster: Raster, width = 480): Promise<Blob> {
  const full = document.createElement("canvas");
  drawRaster(full, raster);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = Math.max(1, Math.round((raster.height * width) / raster.width));
  const ctx = out.getContext("2d");
  if (!ctx) throw new PageError("image_unreadable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(full, 0, 0, out.width, out.height);
  return new Promise((resolve, reject) =>
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new PageError("image_unreadable"))), "image/jpeg", 0.85),
  );
}
