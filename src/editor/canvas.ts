"use client";

import { planEdit } from "./compose";
import type { Edit } from "./types";

export const ARIMO_URL = "/fonts/arimo/arimo-latin-400-normal.woff2";
export const ARIMO_FAMILY = "Arimo";

export type FontMetrics = { digitAscentEm: number };

let loading: Promise<FontMetrics> | null = null;

/**
 * NFR-05: new values are always drawn in the Arimo that ships with the app, never a system font. Loads it
 * once per page and measures its digit height per em. A failed load can be retried.
 */
export function loadArimo(): Promise<FontMetrics> {
  loading ??= (async () => {
    const face = new FontFace(ARIMO_FAMILY, `url(${ARIMO_URL})`, { style: "normal", weight: "400" });
    await face.load();
    document.fonts.add(face);
    // A same-metric system font must never stand in silently.
    if (face.status !== "loaded" || !document.fonts.check(`100px ${ARIMO_FAMILY}`)) {
      document.fonts.delete(face); // a retry must not stack a second face
      throw new Error("Arimo is not available");
    }
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("No 2D canvas");
    ctx.font = `100px ${ARIMO_FAMILY}`;
    const digitAscentEm = ctx.measureText("0123456789").actualBoundingBoxAscent / 100;
    if (!(digitAscentEm > 0.5 && digitAscentEm < 0.9)) throw new Error(`Unexpected Arimo digit height ${digitAscentEm}`);
    return { digitAscentEm };
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** The original page, then every edit over it (BR-03: the original pixels themselves never change). */
export function paintSheet(
  ctx: CanvasRenderingContext2D,
  base: CanvasImageSource,
  edits: readonly Edit[],
  pageW: number,
  pageH: number,
  metrics: FontMetrics,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(base, 0, 0);
  for (const edit of edits) {
    const p = planEdit(edit, pageW, pageH, metrics.digitAscentEm);
    ctx.save();
    ctx.translate(p.cx, p.cy);
    ctx.rotate(p.rad);
    ctx.fillStyle = p.bgColor;
    ctx.fillRect(-p.maskW / 2, -p.maskH / 2, p.maskW, p.maskH);
    ctx.fillStyle = p.textColor;
    ctx.font = `${p.fontSize}px ${ARIMO_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(p.text, 0, p.baseline);
    ctx.restore();
  }
}
