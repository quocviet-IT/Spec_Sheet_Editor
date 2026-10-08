import {
  clamp,
  distance,
  expandRect,
  miniBox,
  orderClockwise,
  polygonArea,
  polygonPerimeter,
  pyRound,
  type Point,
  type Quad,
} from "./geometry";

/** RapidOCR 3.9.2 Det settings (config.yaml). */
export type DetOptions = {
  thresh: number;
  boxThresh: number;
  unclipRatio: number;
  maxCandidates: number;
  minSize: number;
  dilate: boolean;
};

export const DET_DEFAULTS: DetOptions = {
  thresh: 0.3,
  boxThresh: 0.5,
  unclipRatio: 1.6,
  maxCandidates: 1000,
  minSize: 3,
  dilate: true,
};

export type DetBox = { quad: Quad; score: number };

/** Detector input size: shorter side at least 736, both sides multiples of 32 (DetPreProcess, limit_type "min"). */
export function detInputSize(width: number, height: number, limitSideLen = 736): { width: number; height: number } {
  const shorter = Math.min(width, height);
  const ratio = shorter < limitSideLen ? limitSideLen / shorter : 1;
  return {
    width: Math.max(32, pyRound(Math.trunc(width * ratio) / 32) * 32),
    height: Math.max(32, pyRound(Math.trunc(height * ratio) / 32) * 32),
  };
}

/** cv2.dilate with a 2×2 kernel: a pixel is set when it or its left, upper or upper-left neighbour is. */
function dilate2x2(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = src[i] | (x > 0 ? src[i - 1] : 0) | (y > 0 ? src[i - w] : 0) | (x > 0 && y > 0 ? src[i - w - 1] : 0);
    }
  }
  return out;
}

/** 8-connected regions, each as the leftmost and rightmost pixel of every row it covers (enough for the hull). */
function regions(mask: Uint8Array, w: number, h: number): Point[][] {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const result: Point[][] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const rows = new Map<number, [number, number]>();
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      const row = rows.get(y);
      if (!row) rows.set(y, [x, x]);
      else {
        if (x < row[0]) row[0] = x;
        if (x > row[1]) row[1] = x;
      }
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
          const j = ny * w + nx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    const outline: Point[] = [];
    for (const [y, [a, b]] of rows) {
      outline.push({ x: a, y });
      if (b !== a) outline.push({ x: b, y });
    }
    result.push(outline);
  }
  return result;
}

/** The x-range a convex polygon covers on row y, or null. */
function rowSpan(pts: readonly Point[], y: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (y < Math.min(a.y, b.y) || y > Math.max(a.y, b.y)) continue;
    if (a.y === b.y) {
      lo = Math.min(lo, a.x, b.x);
      hi = Math.max(hi, a.x, b.x);
      continue;
    }
    const x = a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return lo <= hi ? [lo, hi] : null;
}

/** OpenCV's 8-connected Bresenham line between whole-pixel points, both ends included. */
function line(a: Point, b: Point, put: (x: number, y: number) => void): void {
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    put(x, y);
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * box_score_fast: mean probability over the pixels cv2.fillPoly paints for the box with its corners
 * truncated to whole pixels — the interior spans plus the outline drawn as 8-connected lines.
 */
function meanInside(prob: Float32Array, w: number, h: number, quad: Quad): number {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const xMin = clamp(Math.floor(Math.min(...xs)), 0, w - 1);
  const xMax = clamp(Math.ceil(Math.max(...xs)), 0, w - 1);
  const yMin = clamp(Math.floor(Math.min(...ys)), 0, h - 1);
  const yMax = clamp(Math.ceil(Math.max(...ys)), 0, h - 1);
  const pts = quad.map((p) => ({ x: Math.trunc(p.x), y: Math.trunc(p.y) }));
  const bw = xMax - xMin + 1;
  const mask = new Uint8Array(bw * (yMax - yMin + 1));
  const put = (x: number, y: number) => {
    if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) mask[(y - yMin) * bw + (x - xMin)] = 1;
  };
  for (let y = yMin; y <= yMax; y++) {
    const span = rowSpan(pts, y);
    if (!span) continue;
    for (let x = Math.ceil(span[0] - 1e-9); x <= Math.floor(span[1] + 1e-9); x++) put(x, y);
  }
  for (let i = 0; i < pts.length; i++) line(pts[i], pts[(i + 1) % pts.length], put);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = xMin + (i % bw);
    const y = yMin + Math.trunc(i / bw);
    sum += prob[y * w + x];
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Probability map (mapW × mapH) → text boxes in source-image pixels (srcW × srcH): RapidOCR's
 * DBPostProcess with score_mode "fast", then filter_det_res.
 */
export function dbPostprocess(
  prob: Float32Array,
  mapW: number,
  mapH: number,
  srcW: number,
  srcH: number,
  opts: DetOptions = DET_DEFAULTS,
): DetBox[] {
  const bitmap = new Uint8Array(mapW * mapH);
  for (let i = 0; i < bitmap.length; i++) bitmap[i] = prob[i] > opts.thresh ? 1 : 0;
  const mask = opts.dilate ? dilate2x2(bitmap, mapW, mapH) : bitmap;

  const boxes: DetBox[] = [];
  for (const outline of regions(mask, mapW, mapH).slice(0, opts.maxCandidates)) {
    const first = miniBox(outline);
    if (first.shortSide < opts.minSize) continue;
    const score = meanInside(prob, mapW, mapH, first.quad);
    if (score < opts.boxThresh) continue;
    const d = (polygonArea(first.quad) * opts.unclipRatio) / polygonPerimeter(first.quad);
    const grown = miniBox(expandRect(first.quad, d));
    if (grown.shortSide < opts.minSize + 2) continue;
    const scaled = grown.quad.map((p) => ({
      x: clamp(pyRound((p.x / mapW) * srcW), 0, srcW),
      y: clamp(pyRound((p.y / mapH) * srcH), 0, srcH),
    }));
    const quad = orderClockwise(scaled).map((p) => ({
      x: Math.trunc(clamp(p.x, 0, srcW - 1)),
      y: Math.trunc(clamp(p.y, 0, srcH - 1)),
    })) as Quad;
    if (Math.trunc(distance(quad[0], quad[1])) <= 3 || Math.trunc(distance(quad[0], quad[3])) <= 3) continue;
    boxes.push({ quad, score });
  }
  return boxes;
}
