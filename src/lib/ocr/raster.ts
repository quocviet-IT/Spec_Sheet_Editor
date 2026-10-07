import { distance, type Point, type Quad, type Rect } from "./geometry";

/**
 * RGBA pixels, row by row (ImageData satisfies this type). Plain arrays rather than canvas, so the
 * same code runs in the Worker and in Vitest.
 */
export type Raster = { width: number; height: number; data: Uint8ClampedArray };

/** A width × height raster of one grey level, fully opaque. */
export function createRaster(width: number, height: number, gray = 255): Raster {
  if (!(width >= 1 && height >= 1)) throw new Error(`Raster size must be positive, got ${width}×${height}`);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function copyPixel(src: Raster, si: number, out: Raster, di: number): void {
  out.data[di] = src.data[si];
  out.data[di + 1] = src.data[si + 1];
  out.data[di + 2] = src.data[si + 2];
  out.data[di + 3] = 255;
}

/** Copies a rectangle; whatever lies outside the source stays white (the sheet's paper). */
export function crop(src: Raster, rect: Rect): Raster {
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const out = createRaster(Math.max(1, Math.round(rect.w)), Math.max(1, Math.round(rect.h)));
  for (let y = 0; y < out.height; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= src.height) continue;
    for (let x = 0; x < out.width; x++) {
      const sx = x0 + x;
      if (sx < 0 || sx >= src.width) continue;
      copyPixel(src, (sy * src.width + sx) * 4, out, (y * out.width + x) * 4);
    }
  }
  return out;
}

/**
 * Bilinear sample at (fx, fy) into out[oi..oi+3]. Outside the source: the `outside` grey level when
 * given, otherwise the nearest edge pixel (OpenCV BORDER_REPLICATE).
 */
function sampleInto(src: Raster, fx: number, fy: number, out: Uint8ClampedArray, oi: number, outside?: number): void {
  out[oi + 3] = 255;
  if (outside !== undefined && (fx < -0.5 || fy < -0.5 || fx > src.width - 0.5 || fy > src.height - 0.5)) {
    out[oi] = outside;
    out[oi + 1] = outside;
    out[oi + 2] = outside;
    return;
  }
  const x = Math.min(Math.max(fx, 0), src.width - 1);
  const y = Math.min(Math.max(fy, 0), src.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, src.width - 1);
  const y1 = Math.min(y0 + 1, src.height - 1);
  const ax = x - x0;
  const ay = y - y0;
  const r0 = y0 * src.width;
  const r1 = y1 * src.width;
  for (let c = 0; c < 3; c++) {
    const top = src.data[(r0 + x0) * 4 + c] * (1 - ax) + src.data[(r0 + x1) * 4 + c] * ax;
    const bottom = src.data[(r1 + x0) * 4 + c] * (1 - ax) + src.data[(r1 + x1) * 4 + c] * ax;
    out[oi + c] = top * (1 - ay) + bottom * ay;
  }
}

/** Bilinear resize with pixel-centre alignment (OpenCV INTER_LINEAR). */
export function resizeBilinear(src: Raster, width: number, height: number): Raster {
  const out = createRaster(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < width; x++) sampleInto(src, (x + 0.5) * sx - 0.5, fy, out.data, (y * width + x) * 4);
  }
  return out;
}

/** Keys' cubic kernel with a = -0.5, Pillow's BICUBIC filter. */
function cubic(x: number): number {
  const a = -0.5;
  const t = Math.abs(x);
  if (t < 1) return ((a + 2) * t - (a + 3)) * t * t + 1;
  if (t < 2) return (((t - 5) * t + 8) * t - 4) * a;
  return 0;
}

/** Pillow's per-axis resampling weights (precompute_coeffs): the filter widens when shrinking. */
function cubicWeights(inSize: number, outSize: number): { start: Int32Array; count: Int32Array; weights: Float32Array; taps: number } {
  const scale = inSize / outSize;
  const filterScale = Math.max(scale, 1);
  const support = 2 * filterScale;
  const taps = Math.ceil(2 * support) + 2;
  const start = new Int32Array(outSize);
  const count = new Int32Array(outSize);
  const weights = new Float32Array(outSize * taps);
  for (let o = 0; o < outSize; o++) {
    const centre = (o + 0.5) * scale;
    const from = Math.max(Math.trunc(centre - support + 0.5), 0);
    const n = Math.min(Math.trunc(centre + support + 0.5), inSize) - from;
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const w = cubic((k + from - centre + 0.5) / filterScale);
      weights[o * taps + k] = w;
      sum += w;
    }
    if (sum !== 0) for (let k = 0; k < n; k++) weights[o * taps + k] /= sum;
    start[o] = from;
    count[o] = n;
  }
  return { start, count, weights, taps };
}

/**
 * Bicubic resize as Pillow's Image.resize(BICUBIC). Sharper than bilinear when enlarging small print: on
 * the sample sheet RapidOCR finds 9 of 11 values after bicubic enlargement, 8 after bilinear.
 */
export function resizeBicubic(src: Raster, width: number, height: number): Raster {
  const h = cubicWeights(src.width, width);
  const v = cubicWeights(src.height, height);
  const mid = new Float32Array(width * src.height * 3);
  for (let y = 0; y < src.height; y++) {
    const row = y * src.width;
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < h.count[x]; k++) {
        const w = h.weights[x * h.taps + k];
        const p = (row + h.start[x] + k) * 4;
        r += src.data[p] * w;
        g += src.data[p + 1] * w;
        b += src.data[p + 2] * w;
      }
      const m = (y * width + x) * 3;
      mid[m] = r;
      mid[m + 1] = g;
      mid[m + 2] = b;
    }
  }
  const out = createRaster(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < v.count[y]; k++) {
        const w = v.weights[y * v.taps + k];
        const m = ((v.start[y] + k) * width + x) * 3;
        r += mid[m] * w;
        g += mid[m + 1] * w;
        b += mid[m + 2] * w;
      }
      const o = (y * width + x) * 4;
      out.data[o] = r;
      out.data[o + 1] = g;
      out.data[o + 2] = b;
    }
  }
  return out;
}

/** A quarter turn clockwise: text running bottom to top becomes horizontal. */
export function rotate90cw(src: Raster): Raster {
  const out = createRaster(src.height, src.width);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) copyPixel(src, ((src.height - 1 - x) * src.width + y) * 4, out, (y * out.width + x) * 4);
  }
  return out;
}

/** A quarter turn counter-clockwise (numpy rot90). */
export function rotate90ccw(src: Raster): Raster {
  const out = createRaster(src.height, src.width);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) copyPixel(src, (x * src.width + (src.width - 1 - y)) * 4, out, (y * out.width + x) * 4);
  }
  return out;
}

export function rotate180(src: Raster): Raster {
  const out = createRaster(src.width, src.height);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      copyPixel(src, ((src.height - 1 - y) * src.width + (src.width - 1 - x)) * 4, out, (y * out.width + x) * 4);
    }
  }
  return out;
}

/**
 * Where a point of a rotateExpand() output lies in the source. Continuous coordinates: (0, 0) is the
 * top-left corner of the image, so pixel (x, y) spans x..x+1.
 */
export function unrotatePoint(p: Point, srcW: number, srcH: number, outW: number, outH: number, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - outW / 2;
  const dy = p.y - outH / 2;
  return { x: srcW / 2 + dx * cos - dy * sin, y: srcH / 2 + dx * sin + dy * cos };
}

/**
 * Turns the image `degrees` counter-clockwise around its centre and grows the canvas to fit
 * (PIL Image.rotate(expand=True)); the new corners are white.
 */
export function rotateExpand(src: Raster, degrees: number): Raster {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const width = Math.ceil(src.width * cos + src.height * sin - 1e-6);
  const height = Math.ceil(src.width * sin + src.height * cos - 1e-6);
  const out = createRaster(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = unrotatePoint({ x: x + 0.5, y: y + 0.5 }, src.width, src.height, width, height, degrees);
      sampleInto(src, p.x - 0.5, p.y - 0.5, out.data, (y * width + x) * 4, 255);
    }
  }
  return out;
}

/** Whether cropQuad turns this quadrilateral's crop a quarter counter-clockwise (it is at least 1.5× taller than wide). */
export function cropTurnsQuarter(quad: Quad): boolean {
  const [tl, tr, br, bl] = quad;
  const width = Math.max(1, Math.trunc(Math.max(distance(tl, tr), distance(br, bl))));
  const height = Math.max(1, Math.trunc(Math.max(distance(tl, bl), distance(tr, br))));
  return height / width >= 1.5;
}

/**
 * Straightens the quadrilateral tl, tr, br, bl into an upright image (RapidOCR get_rotate_crop_image).
 * A crop at least 1.5 times taller than wide is turned a quarter counter-clockwise so the text runs left
 * to right.
 */
export function cropQuad(src: Raster, quad: Quad): Raster {
  const [tl, tr, br, bl] = quad;
  const width = Math.max(1, Math.trunc(Math.max(distance(tl, tr), distance(br, bl))));
  const height = Math.max(1, Math.trunc(Math.max(distance(tl, bl), distance(tr, br))));
  const out = createRaster(width, height);
  for (let v = 0; v < height; v++) {
    const t = v / height;
    for (let u = 0; u < width; u++) {
      const s = u / width;
      const fx = (1 - s) * (1 - t) * tl.x + s * (1 - t) * tr.x + s * t * br.x + (1 - s) * t * bl.x;
      const fy = (1 - s) * (1 - t) * tl.y + s * (1 - t) * tr.y + s * t * br.y + (1 - s) * t * bl.y;
      sampleInto(src, fx, fy, out.data, (v * width + u) * 4);
    }
  }
  return cropTurnsQuarter(quad) ? rotate90ccw(out) : out;
}

/** CHW float tensor in B, G, R order (the models were trained on OpenCV's BGR images): (v / 255 − mean) / std. */
export function toBgrCHW(src: Raster, mean = 0.5, std = 0.5): Float32Array {
  const plane = src.width * src.height;
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    out[i] = (src.data[p + 2] / 255 - mean) / std;
    out[plane + i] = (src.data[p + 1] / 255 - mean) / std;
    out[2 * plane + i] = (src.data[p] / 255 - mean) / std;
  }
  return out;
}
