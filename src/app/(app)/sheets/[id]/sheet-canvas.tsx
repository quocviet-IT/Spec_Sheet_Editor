"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { paintSheet, type FontMetrics } from "@/editor/canvas";
import { panelOf, readingOrder, rectFromDrag, toPx } from "@/editor/geometry";
import type { Detection, Edit } from "@/editor/types";
import { DRAWING_AREA } from "@/lib/form/template";
import type { Point, Rect } from "@/lib/ocr/geometry";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";

/** Markers are at least this big on screen (WCAG 2.2 target size). */
const MIN_TARGET = 24;
/** Markers reach this far beyond the digits, as a share of the digit height. */
const MARK_PAD = 0.35;
/** Locked zones (section 8.1): a faint hatching, nothing to click. */
const HATCH = "repeating-linear-gradient(135deg, rgb(0 0 0 / 0.07) 0 2px, transparent 2px 9px)";

type Props = {
  base: HTMLCanvasElement;
  pageW: number;
  pageH: number;
  metrics: FontMetrics;
  name: string;
  detections: readonly Detection[];
  edits: readonly Edit[];
  activeId: string | null;
  scale: number;
  onFitScale: (scale: number) => void;
  onOpen: (id: string) => void;
  onPageClick?: (p: Point) => void;
  drawing: boolean;
  /** A drawn box waiting for its direction: shown as the dashed outline of the drag. */
  pendingRect?: Rect | null;
  onDrawn: (rect: Rect) => void;
  children?: ReactNode;
};

export function SheetCanvas({ base, pageW, pageH, metrics, name, detections, edits, activeId, scale, onFitScale, onOpen, onPageClick, drawing, pendingRect = null, onDrawn, children }: Props) {
  const t = useMessages();
  const viewport = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  // Fit = the whole page inside the viewport (minus its 16-px padding on each side).
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => onFitScale(Math.max(0.05, Math.min((Math.floor(el.clientWidth) - 33) / pageW, (Math.floor(el.clientHeight) - 33) / pageH)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageW, pageH, onFitScale]);

  // The canvas keeps the page's own pixels; CSS scales it for the zoom.
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    if (c.width !== pageW) c.width = pageW;
    if (c.height !== pageH) c.height = pageH;
    paintSheet(ctx, base, edits, pageW, pageH, metrics);
  }, [base, edits, pageW, pageH, metrics]);

  // Release the canvas memory when the screen closes.
  useEffect(() => {
    const c = canvas.current;
    return () => {
      if (c) {
        c.width = 0;
        c.height = 0;
      }
    };
  }, []);

  const byId = new Map(edits.map((e) => [e.detectionId, e]));
  const a = DRAWING_AREA;
  const band = { top: `${a.y0 * 100}%`, height: `${(a.y1 - a.y0) * 100}%` };
  return (
    <div ref={viewport} tabIndex={0} role="region" aria-label={t.editor.viewport} className="h-full overflow-auto bg-sunk p-4">
      <div
        className="relative mx-auto bg-white shadow"
        style={{ width: pageW * scale, height: pageH * scale }}
        onClick={(e) => {
          if (!onPageClick) return;
          const target = e.target instanceof Element ? e.target : null;
          if (target?.closest("[data-detection], [role='dialog'], form")) return; // markers and popovers handle their own clicks
          const r = e.currentTarget.getBoundingClientRect();
          onPageClick({ x: ((e.clientX - r.left) / r.width) * pageW, y: ((e.clientY - r.top) / r.height) * pageH });
        }}
      >
        <canvas ref={canvas} role="img" aria-label={fill(t.editor.canvas, { name })} className="absolute inset-0 h-full w-full" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0" style={{ height: `${a.y0 * 100}%`, backgroundImage: HATCH }} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height: `${(1 - a.y1) * 100}%`, backgroundImage: HATCH }} />
        <div aria-hidden className="pointer-events-none absolute left-0" style={{ ...band, width: `${a.x0 * 100}%`, backgroundImage: HATCH }} />
        <div aria-hidden className="pointer-events-none absolute right-0" style={{ ...band, width: `${(1 - a.x1) * 100}%`, backgroundImage: HATCH }} />
        {readingOrder(detections).map((d) => {
          const px = toPx(d.box, d.angle, pageW, pageH);
          const edit = byId.get(d.id);
          const active = activeId === d.id;
          const pad = MARK_PAD * px.h;
          const w = Math.max(MIN_TARGET, (px.w + 2 * pad) * scale);
          const h = Math.max(MIN_TARGET, (px.h + 2 * pad) * scale);
          const state = edit ? fill(t.editor.states.edited, { value: edit.newValue }) : active ? t.editor.states.editing : t.editor.states.detected;
          const label = fill(t.editor.marker, {
            value: edit?.oldValue ?? d.readValue ?? t.editor.unread,
            panel: t.editor.panels[panelOf(d.box)],
            state,
          });
          const look = edit
            ? "border-solid border-edit bg-edit/10"
            : active
              ? "border-solid border-mark bg-mark/10"
              : "border-dashed border-mark hover:bg-mark/10";
          return (
            <button
              key={d.id}
              type="button"
              data-detection={d.id}
              aria-label={label}
              aria-haspopup="dialog"
              aria-expanded={active}
              onClick={() => onOpen(d.id)}
              className={"absolute rounded-sm border-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink " + look}
              style={{ left: px.cx * scale - w / 2, top: px.cy * scale - h / 2, width: w, height: h, transform: `rotate(${d.angle}deg)` }}
            >
              {edit ? (
                <span aria-hidden className="absolute -right-2 -top-2 grid size-4 place-items-center rounded-full bg-edit text-[10px] font-bold leading-none text-edit-ink">✓</span>
              ) : null}
            </button>
          );
        })}
        {pendingRect ? <DrawnOutline rect={pendingRect} scale={scale} /> : null}
        {drawing ? <DrawLayer pageW={pageW} pageH={pageH} scale={scale} onDrawn={onDrawn} /> : null}
        {children}
      </div>
    </div>
  );
}

function DrawnOutline({ rect, scale }: { rect: Rect; scale: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 border-2 border-dashed border-mark bg-mark/10"
      style={{ left: rect.x * scale, top: rect.y * scale, width: rect.w * scale, height: rect.h * scale }}
    />
  );
}

/** Draw mode (UC-07 step 1): a crosshair layer over the page; a drag gives a rectangle in page pixels. */
function DrawLayer({ pageW, pageH, scale, onDrawn }: { pageW: number; pageH: number; scale: number; onDrawn: (rect: Rect) => void }) {
  const [drag, setDrag] = useState<{ a: Point; b: Point } | null>(null);
  const toPage = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * pageW, y: ((e.clientY - r.top) / r.height) * pageH };
  };
  const shown = drag ? rectFromDrag(drag.a, drag.b) : null;
  return (
    <div
      aria-hidden
      className="absolute inset-0 z-10 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = toPage(e);
        setDrag({ a: p, b: p });
      }}
      onPointerMove={(e) => {
        if (drag) setDrag({ a: drag.a, b: toPage(e) });
      }}
      onPointerCancel={() => setDrag(null)}
      onLostPointerCapture={() => setDrag(null)}
      onPointerUp={(e) => {
        if (!drag) return;
        const rect = rectFromDrag(drag.a, toPage(e));
        setDrag(null);
        onDrawn(rect);
      }}
    >
      {shown ? (
        <div
          className="absolute border-2 border-dashed border-mark bg-mark/10"
          style={{ left: shown.x * scale, top: shown.y * scale, width: shown.w * scale, height: shown.h * scale }}
        />
      ) : null}
    </div>
  );
}
