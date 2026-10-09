import { DRAWING_AREA } from "@/lib/form/template";
import { normalizeAngle, type Point, type Quad, type Rect } from "@/lib/ocr/geometry";
import type { Box, Detection, Panel, PxBox } from "./types";

export function toBox(px: PxBox, pageW: number, pageH: number): Box {
  return { cx: px.cx / pageW, cy: px.cy / pageH, w: px.w / pageW, h: px.h / pageW };
}

export function toPx(box: Box, angle: number, pageW: number, pageH: number): PxBox {
  return { cx: box.cx * pageW, cy: box.cy * pageH, w: box.w * pageW, h: box.h * pageW, angle };
}

const round = (n: number, places: number) => {
  const r = Math.round(n * 10 ** places) / 10 ** places;
  return r === 0 ? 0 : r; // never -0 in stored JSON
};

/** Stored boxes keep 5 decimals: 0.03 px on a 3300-px page. */
export function roundBox(box: Box): Box {
  return { cx: round(box.cx, 5), cy: round(box.cy, 5), w: round(box.w, 5), h: round(box.h, 5) };
}

export function roundAngle(angle: number): number {
  const r = round(normalizeAngle(angle), 2);
  return r === -180 ? 180 : r; // the schema accepts (-180, 180]
}

/** Unit vectors: `u` along the reading direction, `v` across it (from the top of the digits to their foot). */
export function axes(angle: number): { u: Point; v: Point } {
  const rad = (angle * Math.PI) / 180;
  const u = { x: Math.cos(rad), y: Math.sin(rad) };
  return { u, v: { x: -u.y, y: u.x } };
}

/**
 * The text's own box from a reading's quad and angle. The quad keeps the detector's corner order, not
 * the text's, so the sides are measured by projecting all four corners on the reading axes.
 */
export function boxFromQuad(quad: Quad, angle: number): PxBox {
  const a = normalizeAngle(angle);
  const { u, v } = axes(a);
  let s0 = Infinity;
  let s1 = -Infinity;
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const p of quad) {
    const s = p.x * u.x + p.y * u.y;
    const t = p.x * v.x + p.y * v.y;
    s0 = Math.min(s0, s);
    s1 = Math.max(s1, s);
    t0 = Math.min(t0, t);
    t1 = Math.max(t1, t);
  }
  const sm = (s0 + s1) / 2;
  const tm = (t0 + t1) / 2;
  return { cx: sm * u.x + tm * v.x, cy: sm * u.y + tm * v.y, w: s1 - s0, h: t1 - t0, angle: a };
}

/** Corners in reading order: start-top, end-top, end-foot, start-foot. */
export function boxCorners(px: PxBox): Quad {
  const { u, v } = axes(px.angle);
  const at = (s: number, t: number): Point => ({ x: px.cx + s * u.x + t * v.x, y: px.cy + s * u.y + t * v.y });
  const hw = px.w / 2;
  const hh = px.h / 2;
  return [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)];
}

/** The drawing area (section 2.3) in pixels of a page this size. */
export function drawingAreaPx(pageW: number, pageH: number): Rect {
  const x = Math.round(DRAWING_AREA.x0 * pageW);
  const y = Math.round(DRAWING_AREA.y0 * pageH);
  return { x, y, w: Math.round(DRAWING_AREA.x1 * pageW) - x, h: Math.round(DRAWING_AREA.y1 * pageH) - y };
}

/** BR-02: a value belongs to the drawing when its centre lies inside the four panels. */
export function centreInDrawingArea(box: Box): boolean {
  return box.cx >= DRAWING_AREA.x0 && box.cx <= DRAWING_AREA.x1 && box.cy >= DRAWING_AREA.y0 && box.cy <= DRAWING_AREA.y1;
}

const MID_X = (DRAWING_AREA.x0 + DRAWING_AREA.x1) / 2;
const MID_Y = (DRAWING_AREA.y0 + DRAWING_AREA.y1) / 2;
const PANEL_ORDER: readonly Panel[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];

/** Which of the four panels (two by two) holds the box's centre. */
export function panelOf(box: Box): Panel {
  const right = box.cx >= MID_X;
  const bottom = box.cy >= MID_Y;
  if (bottom) return right ? "bottomRight" : "bottomLeft";
  return right ? "topRight" : "topLeft";
}

/** Tab order (section 8.4): panel by panel, then top to bottom, then left to right. */
export function readingOrder<T extends { box: Box }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => PANEL_ORDER.indexOf(panelOf(a.box)) - PANEL_ORDER.indexOf(panelOf(b.box)) || a.box.cy - b.box.cy || a.box.cx - b.box.cx,
  );
}

/** The rendered page may differ from the stored size by anti-aliasing at the trimmed edge. */
export const SIZE_TOLERANCE_PX = 2;

export function sameSize(w: number, h: number, pageW: number, pageH: number): boolean {
  return Math.abs(w - pageW) <= SIZE_TOLERANCE_PX && Math.abs(h - pageH) <= SIZE_TOLERANCE_PX;
}

/** A drag from one corner to the other, in either direction. */
export function rectFromDrag(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** A drag shorter than this on either side (page pixels) is a click, not a box. */
export const MIN_DRAWN_PX = 4;

/** UC-07 exception 1a: every corner of the drawn rectangle lies inside the four panels. */
export function rectInDrawingArea(rect: Rect, pageW: number, pageH: number): boolean {
  return (
    rect.x >= DRAWING_AREA.x0 * pageW &&
    rect.y >= DRAWING_AREA.y0 * pageH &&
    rect.x + rect.w <= DRAWING_AREA.x1 * pageW &&
    rect.y + rect.h <= DRAWING_AREA.y1 * pageH
  );
}

/** UC-05 exception 1b / UC-06 step 1: a click counts only inside the drawing. */
export function pointInDrawingArea(p: Point, pageW: number, pageH: number): boolean {
  return centreInDrawingArea({ cx: p.x / pageW, cy: p.y / pageH, w: 0, h: 0 });
}

/**
 * UC-07: the text box for a rectangle drawn around a value read at `angle` — the box at that angle that
 * covers the rectangle (for 0 the rectangle itself; for ±90 its sides swap). Tightening to the digits
 * then shrinks it (UC-07 step 3).
 */
export function boxForDrawnRect(rect: Rect, angle: number): PxBox {
  const a = normalizeAngle(angle);
  const rad = (a * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, w: rect.w * c + rect.h * s, h: rect.w * s + rect.h * c, angle: a };
}

/** Margin around a value's box when deciding what a click hit, as a share of its height. */
const HIT_MARGIN = 0.5;

/** The value whose box (in its own frame, with a small margin) holds the point, if any. */
export function detectionAt(detections: readonly Detection[], p: Point, pageW: number, pageH: number): Detection | null {
  let best: Detection | null = null;
  let bestDistance = Infinity;
  for (const d of detections) {
    const px = toPx(d.box, d.angle, pageW, pageH);
    const { u, v } = axes(px.angle);
    const dx = p.x - px.cx;
    const dy = p.y - px.cy;
    const s = dx * u.x + dy * u.y;
    const t = dx * v.x + dy * v.y;
    const margin = HIT_MARGIN * px.h;
    if (Math.abs(s) > px.w / 2 + margin || Math.abs(t) > px.h / 2 + margin) continue;
    // Where the margins of two close values overlap, the one whose own box is nearest wins.
    const distance = (s / Math.max(px.w / 2, 1e-9)) ** 2 + (t / Math.max(px.h / 2, 1e-9)) ** 2;
    if (distance < bestDistance) {
      best = d;
      bestDistance = distance;
    }
  }
  return best;
}
