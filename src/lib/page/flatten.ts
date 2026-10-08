import type { Raster } from "@/lib/ocr/raster";

/** Places the image on white paper: every pixel becomes opaque (TC-11). Returns a new raster. */
export function flattenOnWhite(raster: Raster): Raster {
  const src = raster.data;
  const data = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    data[i] = Math.round(src[i] * a + 255 * (1 - a));
    data[i + 1] = Math.round(src[i + 1] * a + 255 * (1 - a));
    data[i + 2] = Math.round(src[i + 2] * a + 255 * (1 - a));
    data[i + 3] = 255;
  }
  return { width: raster.width, height: raster.height, data };
}
