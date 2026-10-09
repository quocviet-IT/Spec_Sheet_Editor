"use client";

import { paintSheet, type FontMetrics } from "./canvas";
import { pdfLayout, type ExportSource } from "./export-plan";
import type { Edit } from "./types";

/** UC-09 exception 3a: the browser could not render or encode the page (usually memory). */
export class ExportError extends Error {
  readonly code = "render" as const;
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

/** The result page at the page's own resolution, painted exactly as on screen (BR-03: the original stays). */
export function renderResult(base: HTMLCanvasElement, edits: readonly Edit[], width: number, height: number, metrics: FontMetrics): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width !== width) throw new ExportError("No canvas of that size");
  paintSheet(ctx, base, edits, width, height, metrics);
  return canvas;
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ExportError(`Could not encode ${type}`))), type, quality),
  );
}

/** UC-09 step 4: PNG of the page as it is. */
export function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return blobOf(canvas, "image/png");
}

/** UC-09 step 4 / BR-06: one page holding one JPEG (quality 0.92) — no text layer, nothing to select or copy. */
export async function encodePdf(canvas: HTMLCanvasElement, source: ExportSource, title: string): Promise<Blob> {
  const jpeg = await blobOf(canvas, "image/jpeg", 0.92);
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const layout = pdfLayout(canvas.width, canvas.height, source);
  const page = doc.addPage([layout.pageWidth, layout.pageHeight]);
  const image = await doc.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
  page.drawImage(image, { x: layout.x, y: layout.y, width: layout.width, height: layout.height });
  doc.setTitle(title);
  doc.setProducer("Spec Sheet Editor");
  doc.setCreator("Spec Sheet Editor");
  const bytes = await doc.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

/** The browser saves the file; nothing is stored on the server (NFR-03). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
