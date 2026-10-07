/** Geometry for text boxes. Pixel (x, y) has its centre at (x, y), as in OpenCV. */
export type Point = { x: number; y: number };
/** Corners in the order top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];
export type Rect = { x: number; y: number; w: number; h: number };

/** Python's round(): halves go to the even neighbour (kept so sizes match RapidOCR exactly). */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Andrew's monotone chain; collinear and duplicate points are dropped. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const pts = sorted.filter((p, i) => i === 0 || p.x !== sorted[i - 1].x || p.y !== sorted[i - 1].y);
  if (pts.length === 0) return [];
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.length > 0 ? hull : [pts[0]];
}

/** Smallest-area rectangle around the points: rotating calipers over the hull (OpenCV minAreaRect). */
export function minAreaRect(points: readonly Point[]): { corners: Quad; width: number; height: number } {
  const hull = convexHull(points);
  if (hull.length === 0) throw new Error("minAreaRect needs at least one point");
  if (hull.length === 1) {
    const p = hull[0];
    return { corners: [p, p, p, p], width: 0, height: 0 };
  }
  let best: { area: number; u: Point; n: Point; u0: number; u1: number; n0: number; n1: number } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = distance(a, b);
    if (len === 0) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -u.y, y: u.x };
    let u0 = Infinity;
    let u1 = -Infinity;
    let n0 = Infinity;
    let n1 = -Infinity;
    for (const p of hull) {
      const pu = p.x * u.x + p.y * u.y;
      const pn = p.x * n.x + p.y * n.y;
      u0 = Math.min(u0, pu);
      u1 = Math.max(u1, pu);
      n0 = Math.min(n0, pn);
      n1 = Math.max(n1, pn);
    }
    const area = (u1 - u0) * (n1 - n0);
    if (best === null || area < best.area - 1e-9) best = { area, u, n, u0, u1, n0, n1 };
  }
  const { u, n, u0, u1, n0, n1 } = best!;
  const at = (pu: number, pn: number): Point => ({ x: u.x * pu + n.x * pn, y: u.y * pu + n.y * pn });
  return { corners: [at(u0, n0), at(u1, n0), at(u1, n1), at(u0, n1)], width: u1 - u0, height: n1 - n0 };
}

/** RapidOCR get_mini_boxes: the min-area rectangle as tl, tr, br, bl, and its shorter side. */
export function miniBox(points: readonly Point[]): { quad: Quad; shortSide: number } {
  const rect = minAreaRect(points);
  const p = [...rect.corners].sort((a, b) => a.x - b.x);
  const [i1, i4] = p[1].y > p[0].y ? [0, 1] : [1, 0];
  const [i2, i3] = p[3].y > p[2].y ? [2, 3] : [3, 2];
  return { quad: [p[i1], p[i2], p[i3], p[i4]], shortSide: Math.min(rect.width, rect.height) };
}

/**
 * The rectangle tl, tr, br, bl grown by d on every side. For a rectangle this is exactly the
 * min-area box of pyclipper's round offset, which RapidOCR's unclip computes.
 */
export function expandRect(quad: Quad, d: number): Quad {
  const [tl, tr, , bl] = quad;
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  const w = distance(tl, tr);
  const h = distance(tl, bl);
  const u = w > 0 ? { x: (tr.x - tl.x) / w, y: (tr.y - tl.y) / w } : { x: 1, y: 0 };
  const v = h > 0 ? { x: (bl.x - tl.x) / h, y: (bl.y - tl.y) / h } : { x: -u.y, y: u.x };
  const hw = w / 2 + d;
  const hh = h / 2 + d;
  const at = (su: number, sv: number): Point => ({ x: cx + su * hw * u.x + sv * hh * v.x, y: cy + su * hw * u.y + sv * hh * v.y });
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

/** RapidOCR order_points_clockwise: tl, tr, br, bl. */
export function orderClockwise(points: readonly Point[]): Quad {
  const xs = [...points].sort((a, b) => a.x - b.x);
  const [tl, bl] = xs.slice(0, 2).sort((a, b) => a.y - b.y);
  const [tr, br] = xs.slice(2, 4).sort((a, b) => a.y - b.y);
  return [tl, tr, br, bl];
}

export function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeter(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += distance(points[i], points[(i + 1) % points.length]);
  return sum;
}

export function bounds(points: readonly Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
