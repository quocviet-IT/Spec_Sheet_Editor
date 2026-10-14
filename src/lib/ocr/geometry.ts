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

function signedArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * The area two convex polygons have in common (Sutherland–Hodgman: `a` clipped by each edge of `b`).
 * Either may run either way round; a polygon without area shares none.
 */
export function convexIntersectionArea(a: readonly Point[], b: readonly Point[]): number {
  const turn = Math.sign(signedArea(b));
  if (turn === 0 || signedArea(a) === 0) return 0;
  let poly: Point[] = [...a];
  for (let i = 0; i < b.length && poly.length > 0; i++) {
    const p = b[i];
    const q = b[(i + 1) % b.length];
    // Positive inside the edge p → q, for b's own direction.
    const side = (r: Point) => turn * ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    const cut = (r: Point, s: Point, sr: number, ss: number): Point => {
      const t = sr / (sr - ss);
      return { x: r.x + t * (s.x - r.x), y: r.y + t * (s.y - r.y) };
    };
    const next: Point[] = [];
    for (let j = 0; j < poly.length; j++) {
      const prev = poly[(j + poly.length - 1) % poly.length];
      const cur = poly[j];
      const sp = side(prev);
      const sc = side(cur);
      if (sc >= 0) {
        if (sp < 0) next.push(cut(prev, cur, sp, sc));
        next.push(cur);
      } else if (sp >= 0) {
        next.push(cut(prev, cur, sp, sc));
      }
    }
    poly = next;
  }
  return poly.length < 3 ? 0 : polygonArea(poly);
}

/** How much of the smaller of two convex quads the other covers: 0 (apart) to 1 (one lies inside the other). */
export function overlapShare(a: readonly Point[], b: readonly Point[]): number {
  const smaller = Math.min(polygonArea(a), polygonArea(b));
  return smaller > 0 ? convexIntersectionArea(a, b) / smaller : 0;
}

/** Two readings whose quads share at least this much of the smaller one sit at the same place (UC-04 step 4). */
export const SAME_PLACE_OVERLAP = 0.5;

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

/** An angle in degrees, normalised to (-180, 180]. */
export function normalizeAngle(degrees: number): number {
  const a = ((degrees % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

/**
 * The reading direction of a text line, in degrees on the page (y down, 0 = left to right, the editor's
 * convention), from its quad. `quad` is in the pixels of the image that was read, in the detector's order
 * (`orderClockwise`: tl, tr, br, bl); `turn` is the reader's own turn of the crop (`Reading.turn`); and
 * `imageTurn` is the page angle of that image's left-to-right direction (0 upright, -90 for the scan's
 * clockwise pass, `a` for a click image turned `a` degrees counter-clockwise).
 *
 * `cropQuad` samples tl → tr along the crop's width and tl → bl along its height. A crop read as it is
 * runs tl → tr; a tall crop is first turned a quarter counter-clockwise, after which its text runs tl → bl.
 * An upside-down reading (turn 180 or 270) runs the other way.
 */
export function angleFromQuad(quad: Quad, turn: 0 | 90 | 180 | 270, imageTurn: number): number {
  const [tl, tr, , bl] = quad;
  const end = turn === 0 || turn === 180 ? tr : bl;
  const along = (Math.atan2(end.y - tl.y, end.x - tl.x) * 180) / Math.PI;
  return normalizeAngle(along + (turn >= 180 ? 180 : 0) + imageTurn);
}
