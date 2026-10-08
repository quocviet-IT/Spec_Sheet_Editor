"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { paintSheet, type FontMetrics } from "@/editor/canvas";
import { panelOf, readingOrder, toPx } from "@/editor/geometry";
import type { Detection, Edit } from "@/editor/types";
import { DRAWING_AREA } from "@/lib/form/template";
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
  children?: ReactNode;
};

export function SheetCanvas({ base, pageW, pageH, metrics, name, detections, edits, activeId, scale, onFitScale, onOpen, children }: Props) {
  const t = useMessages();
  const viewport = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  // Fit = the whole page inside the viewport (minus its 16-px padding on each side).
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => onFitScale(Math.max(0.05, Math.min((el.clientWidth - 32) / pageW, (el.clientHeight - 32) / pageH)));
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

  const byId = new Map(edits.map((e) => [e.detectionId, e]));
  const a = DRAWING_AREA;
  const band = { top: `${a.y0 * 100}%`, height: `${(a.y1 - a.y0) * 100}%` };
  return (
    <div ref={viewport} className="h-full overflow-auto bg-sunk p-4">
      <div className="relative mx-auto bg-white shadow" style={{ width: pageW * scale, height: pageH * scale }}>
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
          const state = edit ? fill(t.editor.states.edited, { value: edit.newValue }) : t.editor.states.detected;
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
                <span aria-hidden className="absolute -right-2 -top-2 grid size-4 place-items-center rounded-full bg-edit text-[10px] font-bold leading-none text-white">✓</span>
              ) : null}
            </button>
          );
        })}
        {children}
      </div>
    </div>
  );
}
