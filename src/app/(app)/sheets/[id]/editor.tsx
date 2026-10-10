"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { loadArimo, type FontMetrics } from "@/editor/canvas";
import { encodePdf, encodePng, downloadBlob, releaseCanvas, renderResult } from "@/editor/export";
import { exportFileName, exportSuggestions, type ExportSource, type Suggestion } from "@/editor/export-plan";
import { matchingValues } from "@/editor/matching";
import { detectValues, makeEdit, ocrFailureReason, toDetection, type LoadedPage } from "@/editor/detections";
import { boxForDrawnRect, boxFromQuad, detectionAt, MIN_DRAWN_PX, panelOf, pointInDrawingArea, readingOrder, rectInDrawingArea, sameSize, toPx } from "@/editor/geometry";
import { analyseBox } from "@/editor/pixels";
import type { Detection, Edit } from "@/editor/types";
import { zoomIn, zoomOut, type Zoom } from "@/editor/zoom";
import type { OcrClient } from "@/lib/ocr/client";
import type { Point, Rect } from "@/lib/ocr/geometry";
import { drawRaster, renderSource, trimPage, type RenderedPage } from "@/lib/page/render";
import type { Messages } from "@/messages";
import { useLocale, useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import { loadEditorState, logExport, saveSheet } from "@/sheets/actions";
import { clockTime } from "@/sheets/format";
import type { EditorSheet, SaveResult } from "@/sheets/types";
import { AngleDialog } from "./angle-dialog";
import { ConflictDialog } from "./conflict-dialog";
import { EditPopover } from "./edit-popover";
import { ExportDialog } from "./export-dialog";
import { ExportMenu } from "./export-menu";
import { MatchPrompt } from "./match-prompt";
import { NameField } from "./name-field";
import { SheetCanvas } from "./sheet-canvas";
import { useLeaveGuard } from "./use-leave-guard";
import { useValueReader } from "./use-value-reader";
import { ValueList, type DetectState } from "./value-list";

const WIDE = "(min-width: 1024px)";

function useWideScreen(): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(WIDE);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => null,
  );
}

export function Editor({ sheet }: { sheet: EditorSheet }) {
  const t = useMessages();
  const wide = useWideScreen();
  const [opened, setOpened] = useState(false);
  if (wide && !opened) setOpened(true);
  if (opened) return <EditorBody sheet={sheet} />;
  if (wide === false) return <p className="rounded-md border border-line bg-warn-soft px-3 py-2 text-sm">{t.editor.desktopOnly}</p>;
  return null;
}

type Loaded = { page: LoadedPage; base: HTMLCanvasElement; metrics: FontMetrics };
type LoadError = "load" | "font" | "size";
type SaveState = { state: "idle" | "saving" | "offline" | "failed" | "trashed" } | { state: "saved"; at: string };

/** Beside a point, on the right when it fits inside the page, otherwise on the left; never below the page. */
function besideStyle(cx: number, cy: number, reach: number, pageW: number, pageH: number, scale: number, width: number, height: number): CSSProperties {
  const x = cx * scale;
  const y = cy * scale;
  const left = x + reach + width <= pageW * scale ? x + reach : Math.max(0, x - reach - width);
  const top = Math.max(0, Math.min(y - 24, pageH * scale - height));
  return { left, top };
}

/** Edits compared by value, not by the order they were applied in. */
function snapshot(name: string, detections: readonly Detection[], edits: readonly Edit[]): string {
  return JSON.stringify({ name, detections, edits: [...edits].sort((a, b) => (a.detectionId < b.detectionId ? -1 : 1)) });
}

function EditorBody({ sheet }: { sheet: EditorSheet }) {
  const t = useMessages();
  const locale = useLocale();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [detections, setDetections] = useState<Detection[]>(sheet.detections);
  const [edits, setEdits] = useState<Edit[]>(sheet.edits);
  const [name, setName] = useState(sheet.name);
  const [match, setMatch] = useState<{ from: string; oldValue: string; newValue: string; ids: string[] } | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(sheet.name, sheet.detections, sheet.edits));
  const [detect, setDetect] = useState<DetectState>(sheet.version === 1 ? "running" : sheet.detections.length === 0 ? "none" : "idle");
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const [firstStore, setFirstStore] = useState(false);
  const [conflict, setConflict] = useState<{ byName: string | null; savedAt: string | null } | null>(null);
  const [conflictLoad, setConflictLoad] = useState<{ loading: boolean; failed: "load" | "broken" | null }>({ loading: false, failed: null });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [fitScale, setFitScale] = useState(0.25);
  const reader = useValueReader();
  const ensureReader = useRef(reader.ensure);
  /** The latest props, for the load effect, which must run once per sheet (the signed link changes on every render). */
  const sheetRef = useRef(sheet);
  const storeRef = useRef<() => Promise<void>>(async () => {});
  const [notice, setNotice] = useState<{ id: number; kind: "status" | "alert"; text: (m: Messages) => string; draw?: boolean; wait?: boolean } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawn, setDrawn] = useState<Rect | null>(null);
  const [exporting, setExporting] = useState<{ format: "png" | "pdf"; busy: boolean; failed: boolean } | null>(null);
  const drawButton = useRef<HTMLButtonElement | null>(null);
  const opener = useRef<"marker" | "row">("marker");
  const noticeSeq = useRef(0);
  const matchRef = useRef<typeof match>(null);
  const drawingRef = useRef(false);
  /** Mirrors whether S5 is open, for listeners and awaits that must not open anything behind it. */
  const exportOpenRef = useRef(false);
  const [nameKey, setNameKey] = useState(0);
  const readingNow = useRef(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  /** The latest lists and version, for saves started from listeners and after awaits. */
  const latest = useRef({ detections: sheet.detections, edits: sheet.edits, version: sheet.version, name: sheet.name, saved: snapshot(sheet.name, sheet.detections, sheet.edits), firstStore: false });

  useEffect(() => {
    latest.current = { ...latest.current, detections, edits, name, saved: savedSnapshot, firstStore };
    ensureReader.current = reader.ensure;
    matchRef.current = match;
    sheetRef.current = sheet;
    drawingRef.current = drawing;
    exportOpenRef.current = exporting !== null;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Every notice has its own id, so the same refusal twice is a new alert for a screen reader. */
  /** A notice keeps its message, not its words: a language switch while it is showing changes them too. */
  const notify = useCallback((n: { kind: "status" | "alert"; text: (m: Messages) => string; draw?: boolean; wait?: boolean }) => {
    noticeSeq.current += 1;
    setNotice({ ...n, id: noticeSeq.current });
  }, []);

  const dirty = snapshot(name, detections, edits) !== savedSnapshot || firstStore;
  const conflictOpen = conflict !== null;
  const drawnOpen = drawn !== null;
  const popoverOpen = activeId !== null;
  const exportOpen = exporting !== null;
  const loadedReady = loaded !== null;
  const detectRunning = detect === "running";
  const scale = zoom === "fit" ? fitScale : zoom;
  const onFitScale = useCallback((s: number) => setFitScale(s), []);
  /** Leaves draw mode; an alert raised while drawing goes with it. */
  const endDraw = useCallback(() => {
    setDrawing(false);
    setDrawn(null);
    setNotice((n) => (n?.draw ? null : n));
  }, []);

  const focusMarker = useCallback((id: string) => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-detection="${CSS.escape(id)}"]`)?.focus());
  }, []);
  /** Focus goes back to what opened the popover: the marker on the page or the row in the list. */
  const focusOpener = useCallback((id: string) => {
    const own = CSS.escape(id);
    const selector = opener.current === "row" ? `[data-value-row="${own}"]` : `[data-detection="${own}"]`;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
  }, []);
  const focusDrawButton = useCallback(() => {
    requestAnimationFrame(() => drawButton.current?.focus());
  }, []);
  /** Closes the matching prompt; if focus was inside it, hands focus to the marker it came from (or the Draw box button). */
  const closeMatch = useCallback(
    (toDraw = false) => {
      const m = matchRef.current;
      if (!m) return;
      matchRef.current = null;
      const inside = document.activeElement?.closest("[data-match-prompt]") != null;
      setMatch(null);
      if (!inside) return;
      if (toDraw) focusDrawButton();
      else focusMarker(m.from);
    },
    [focusMarker, focusDrawButton],
  );

  /** Take what the database holds (after a conflict, or when someone else stored the first detection). */
  const reloadLatest = useCallback(async (): Promise<"ok" | "broken" | "failed"> => {
    let state: Awaited<ReturnType<typeof loadEditorState>> | undefined;
    try {
      state = await loadEditorState(sheet.id);
    } catch {
      if (alive.current) setSave({ state: "offline" });
      return "failed";
    }
    if (!alive.current) return "failed";
    if (!state || "error" in state) {
      setSave({ state: "failed" });
      return state && state.error === "broken" ? "broken" : "failed";
    }
    const saved = snapshot(state.name, state.detections, state.edits);
    latest.current = { detections: state.detections, edits: state.edits, version: state.version, name: state.name, saved, firstStore: false };
    setFirstStore(false);
    setConflict(null);
    setDetections(state.detections);
    setEdits(state.edits);
    setName(state.name);
    closeMatch();
    endDraw();
    setNotice(null);
    setNameKey((k) => k + 1);
    setSavedSnapshot(saved);
    setActiveId(null);
    setDetect(state.detections.length === 0 ? "none" : "idle");
    setSave({ state: state.deleted ? "trashed" : "idle" });
    return "ok";
  }, [sheet.id, closeMatch, endDraw]);

  /**
   * UC-08: save the lists with the version this screen holds. Nothing happens while a save is running
   * or when nothing changed, unless this is the first store of a detection (stored even when it found
   * nothing, so the sheet is not scanned again; it stays pending until it succeeds).
   */
  const store = useCallback(
    async () => {
      const sent = latest.current;
      const force = sent.firstStore;
      if (inFlight.current || (!force && snapshot(sent.name, sent.detections, sent.edits) === sent.saved)) return;
      inFlight.current = true;
      closeMatch();
      setSave({ state: "saving" });
      let result: SaveResult | undefined;
      try {
        result = await saveSheet({ id: sheet.id, version: sent.version, name: sent.name, detections: sent.detections, edits: sent.edits });
      } catch {
        inFlight.current = false;
        if (alive.current) setSave({ state: "offline" });
        return;
      }
      inFlight.current = false;
      if (!alive.current) return;
      if (!result || typeof result !== "object") {
        setSave({ state: "failed" });
        return;
      }
      if ("ok" in result) {
        const saved = snapshot(sent.name, sent.detections, sent.edits);
        latest.current = { ...latest.current, version: result.version, saved, firstStore: false };
        setFirstStore(false);
        setSavedSnapshot(saved);
        setSave({ state: "saved", at: result.savedAt });
        return;
      }
      if (result.error === "conflict") {
        if (force) {
          await reloadLatest(); // someone else stored the first detection; take theirs
          return;
        }
        setConflictLoad({ loading: false, failed: null });
        if (exportOpenRef.current) {
          exportOpenRef.current = false;
          setExporting(null); // one modal at a time: the conflict dialog owns Escape and focus
        }
        setConflict({ byName: result.byName, savedAt: result.savedAt });
        setSave({ state: "idle" });
        return;
      }
      setSave({ state: result.error === "trashed" ? "trashed" : "failed" });
    },
    [sheet.id, reloadLatest, closeMatch],
  );

  useEffect(() => {
    storeRef.current = store;
  });

  // Load the page and the font; on the first open, detect and store the values (UC-04).
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const font = loadArimo();
    font.catch(() => {}); // handled below; avoids an unhandled rejection when the page fails first
    (async () => {
      let rendered: RenderedPage;
      try {
        const response = await fetch(sheetRef.current.sourceUrl ?? "", { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        rendered = await renderSource(await response.blob(), sheetRef.current.sourceType);
      } catch {
        if (!cancelled) {
          setLoadError("load");
          setDetect("idle");
        }
        return;
      }
      let metrics: FontMetrics;
      try {
        metrics = await font;
      } catch {
        if (!cancelled) {
          setLoadError("font");
          setDetect("idle");
        }
        return;
      }
      if (cancelled) return;
      const trimmed = trimPage(rendered);
      if (!sameSize(trimmed.raster.width, trimmed.raster.height, sheetRef.current.pageW, sheetRef.current.pageH)) {
        setLoadError("size");
        setDetect("idle");
        return;
      }
      const canvas = document.createElement("canvas");
      drawRaster(canvas, trimmed.raster);
      const source: ExportSource = rendered.pagePt
        ? { kind: "pdf", pageWidthPt: rendered.pagePt.width, pageHeightPt: rendered.pagePt.height, pxPerPt: rendered.raster.width / rendered.pagePt.width, offsetX: trimmed.offsetX, offsetY: trimmed.offsetY }
        : { kind: "image" };
      const page: LoadedPage = { raster: trimmed.raster, text: rendered.text, offsetX: trimmed.offsetX, offsetY: trimmed.offsetY, source };
      setLoaded({ page, base: canvas, metrics });
      // Only a sheet that has never stored anything is scanned, and never twice: whatever is held now
      // (stored or pending) stays, because the edits point at its ids.
      const held = latest.current;
      if (held.version !== 1 || held.detections.length > 0 || held.firstStore) return;
      const result = await detectValues(page, () => ensureReader.current(page.raster), undefined, () => cancelled);
      if (cancelled) return;
      if (!result.ok) {
        if (result.reason !== "cancelled") setDetect(result.reason);
        return;
      }
      latest.current = { ...latest.current, detections: result.detections, firstStore: true };
      setDetections(result.detections);
      setFirstStore(true);
      setDetect(result.detections.length === 0 ? "none" : "idle");
      await storeRef.current();
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sheet.id]);

  // Release the previous base canvas once a new one replaces it, and the last one on unmount, so the
  // canvas being painted is never zeroed while it is still in use.
  useEffect(
    () => () => {
      if (loaded) {
        loaded.base.width = 0;
        loaded.base.height = 0;
      }
    },
    [loaded],
  );

  // Ctrl+S saves (UC-08); + / − / 0 zoom (section 8.4) unless typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!conflictOpen && !exportOpen) void store();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (exportOpen) return; // the pre-export check owns the keyboard, Escape included
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "k" || e.key === "K") {
        if (e.repeat || !loadedReady || detectRunning || conflictOpen || drawnOpen || popoverOpen || match !== null || target?.closest("[role='dialog']")) return;
        if (drawing) endDraw();
        else setDrawing(true);
      } else if (e.key === "Escape") {
        if (!drawing || e.defaultPrevented) return; // already handled by the popover, the prompt or a dialog
        endDraw();
      } else if (conflictOpen) return;
      else if (e.key === "+" || e.key === "=") setZoom(zoomIn(scale));
      else if (e.key === "-") setZoom(zoomOut(scale));
      else if (e.key === "0") setZoom("fit");
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, scale, conflictOpen, exportOpen, drawing, drawnOpen, popoverOpen, match, loadedReady, detectRunning, endDraw]);

  useLeaveGuard(dirty, t.editor.leave);

  const W = loaded?.page.raster.width ?? sheet.pageW;
  const H = loaded?.page.raster.height ?? sheet.pageH;

  const ensureNow = reader.ensure;
  // A sheet whose values all came from the PDF text layer needs no reader until someone clicks (no OCR download on open).
  const textLayerOnly = detections.length > 0 && detections.every((d) => d.source === "pdf-text");
  // Start the reader shortly after the page is ready, so a click usually reads at once (NFR-01: ≤ 5 s).
  useEffect(() => {
    if (!loaded || textLayerOnly || (detect !== "idle" && detect !== "none")) return;
    const timer = window.setTimeout(() => void ensureNow(loaded.page.raster).catch(() => {}), 1500);
    return () => window.clearTimeout(timer);
  }, [loaded, detect, textLayerOnly, ensureNow]);

  function closePopover(id: string) {
    setActiveId(null);
    focusOpener(id);
  }

  function apply(detection: Detection, oldValue: string, newValue: string) {
    if (!loaded) return;
    setMatch(null);
    const edit = makeEdit(loaded.page.raster, detection, oldValue, newValue);
    const next = [...latest.current.edits.filter((e) => e.detectionId !== detection.id), edit];
    const others = matchingValues(latest.current.detections, next, oldValue, detection.id);
    setEdits(next);
    latest.current = { ...latest.current, edits: next };
    setActiveId(null);
    if (others.length > 0) {
      const next = { from: detection.id, oldValue, newValue, ids: others.map((d) => d.id) };
      matchRef.current = next;
      setMatch(next);
    }
    else focusOpener(detection.id);
  }

  function applyMatches() {
    if (!loaded || !match) return;
    // Only values still unedited now; every existing edit stays.
    const targets = latest.current.detections.filter(
      (d) => match.ids.includes(d.id) && !latest.current.edits.some((e) => e.detectionId === d.id),
    );
    const added = targets.map((d) => makeEdit(loaded.page.raster, d, match.oldValue, match.newValue));
    const next = [...latest.current.edits, ...added];
    latest.current = { ...latest.current, edits: next };
    setEdits(next);
    closeMatch();
  }

  function applySuggestion(s: Suggestion) {
    if (!loaded) return;
    // Only values still unedited now; every existing edit stays.
    const targets = latest.current.detections.filter(
      (d) => s.ids.includes(d.id) && !latest.current.edits.some((e) => e.detectionId === d.id),
    );
    if (targets.length === 0) return;
    const added = targets.map((d) => makeEdit(loaded.page.raster, d, s.oldValue, s.newValue));
    const next = [...latest.current.edits, ...added];
    latest.current = { ...latest.current, edits: next };
    setEdits(next);
  }

  async function runExport() {
    if (!loaded || !exporting) return;
    const { format } = exporting;
    setExporting({ format, busy: true, failed: false });
    let canvas: HTMLCanvasElement | null = null;
    try {
      // Let the busy state paint before the page is rendered.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const { raster, source } = loaded.page;
      canvas = renderResult(loaded.base, latest.current.edits, raster.width, raster.height, loaded.metrics);
      const file = exportFileName(latest.current.name, format);
      const blob = format === "png" ? await encodePng(canvas) : await encodePdf(canvas, source, latest.current.name);
      downloadBlob(blob, file);
      void logExport({ id: sheet.id, format, edits: latest.current.edits.length, unsaved: dirty }).catch((error) => console.error("logExport failed:", error));
      if (!alive.current) return;
      setExporting(null);
      notify({ kind: "status", text: (m) => fill(m.editor.export.done, { file }) });
    } catch (error) {
      console.error("Export failed:", error instanceof Error ? error.message : String(error));
      if (alive.current && exportOpenRef.current) setExporting({ format, busy: false, failed: true });
    } finally {
      if (canvas) releaseCanvas(canvas);
    }
  }

  function revert(id: string) {
    closeMatch();
    setEdits((list) => list.filter((e) => e.detectionId !== id));
    closePopover(id);
  }

  function open(id: string, from: "marker" | "row" = "marker") {
    if (exportOpenRef.current) return; // nothing opens behind the pre-export check
    opener.current = from;
    setMatch(null);
    setNotice(null);
    setActiveId(id);
    requestAnimationFrame(() =>
      document.querySelector(`[data-detection="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    );
  }

  function onDrawn(rect: Rect) {
    if (rect.w < MIN_DRAWN_PX || rect.h < MIN_DRAWN_PX) return;
    closeMatch(true);
    if (detect === "running") {
      // The first detection replaces the value list when it finishes, which would drop a drawn value.
      notify({ kind: "status", text: (m) => m.editor.waitDetect, wait: true });
      return;
    }
    if (!rectInDrawingArea(rect, W, H)) {
      notify({ kind: "alert", text: (m) => m.editor.drawOutside, draw: true });
      return;
    }
    setNotice(null);
    setDrawn(rect);
  }

  function onAngle(angle: number) {
    if (!loaded || !drawn) return;
    closeMatch(true);
    const px = boxForDrawnRect(drawn, angle);
    setDrawn(null);
    if (!analyseBox(loaded.page.raster, px)) {
      notify({ kind: "alert", text: (m) => m.editor.drawEmpty, draw: true });
      focusDrawButton();
      return;
    }
    const added = toDetection(loaded.page.raster, px, { readValue: null, confidence: null, source: "manual" }, () => crypto.randomUUID());
    latest.current = { ...latest.current, detections: [...latest.current.detections, added] };
    setDetections((list) => [...list, added]);
    endDraw();
    open(added.id);
  }

  async function readAt(p: Point) {
    if (drawing || !loaded || readingNow.current || !pointInDrawingArea(p, W, H)) return;
    if (detect === "running") {
      notify({ kind: "status", text: (m) => m.editor.waitDetect, wait: true });
      return;
    }
    readingNow.current = true;
    notify({ kind: "status", text: reader.state === "ready" ? (m) => m.editor.reading : (m) => m.editor.readerLoading });
    try {
      let client: OcrClient;
      try {
        client = await reader.ensure(loaded.page.raster);
      } catch (error) {
        if (alive.current) notify({ kind: "alert", text: ocrFailureReason(error) === "ocr_unsupported" ? (m) => m.editor.ocrUnsupported : (m) => m.editor.ocrLoad });
        return;
      }
      if (alive.current) notify({ kind: "status", text: (m) => m.editor.reading });
      let result: Awaited<ReturnType<OcrClient["read"]>> | null = null;
      let crashed = false;
      try {
        result = await client.read(p);
      } catch {
        crashed = true;
      }
      if (!alive.current) return;
      if (crashed) reader.reset(); // the Worker is gone; the next click starts a new one
      const r = result?.reading ?? null;
      const px = r ? boxFromQuad(r.quad, r.angle) : null;
      if (!r || !px || !pointInDrawingArea({ x: px.cx, y: px.cy }, W, H)) {
        notify({ kind: "alert", text: (m) => m.editor.clickNoRead });
        return;
      }
      setNotice(null);
      if (drawingRef.current) endDraw(); // never a popover with the draw layer on
      const hit = detectionAt(latest.current.detections, { x: px.cx, y: px.cy }, W, H);
      if (hit) {
        open(hit.id);
        return;
      }
      const added = toDetection(loaded.page.raster, px, { readValue: r.value, confidence: Math.min(100, Math.max(0, Math.round(r.score * 100))), source: "click" }, () => crypto.randomUUID());
      latest.current = { ...latest.current, detections: [...latest.current.detections, added] };
      setDetections((list) => [...list, added]);
      open(added.id);
    } finally {
      readingNow.current = false;
    }
  }

  const exportItems = exporting
    ? readingOrder(detections).flatMap((d) => {
        const edit = edits.find((e) => e.detectionId === d.id);
        return edit ? [{ id: d.id, oldValue: edit.oldValue, newValue: edit.newValue, panel: t.editor.panels[panelOf(d.box)] }] : [];
      })
    : [];
  const exportSuggestionList = exporting ? exportSuggestions(detections, edits) : [];

  const active = loaded && activeId ? detections.find((d) => d.id === activeId) ?? null : null;
  const popoverPx = active ? toPx(active.box, active.angle, W, H) : null;
  const popover = active && popoverPx ? (
    <EditPopover
      key={active.id}
      detection={active}
      edit={edits.find((e) => e.detectionId === active.id) ?? null}
      style={besideStyle(popoverPx.cx, popoverPx.cy, (Math.hypot(popoverPx.w, popoverPx.h) / 2) * scale + 12, W, H, scale, 320, 340)}
      onApply={(oldValue, newValue) => apply(active, oldValue, newValue)}
      onRevert={() => revert(active.id)}
      onClose={(refocus) => (refocus ? closePopover(active.id) : setActiveId(null))}
    />
  ) : null;

  const angleDialog = drawn ? (
    <AngleDialog
      style={besideStyle(drawn.x + drawn.w / 2, drawn.y + drawn.h / 2, (Math.hypot(drawn.w, drawn.h) / 2) * scale + 12, W, H, scale, 288, 360)}
      onChoose={onAngle}
      onCancel={() => { setDrawn(null); focusDrawButton(); }}
    />
  ) : null;

  function rename(next: string) {
    latest.current = { ...latest.current, name: next }; // a save started in the same keystroke sends it
    setName(next);
  }

  async function loadLatest() {
    setConflictLoad({ loading: true, failed: null });
    const outcome = await reloadLatest();
    if (alive.current && outcome !== "ok") setConflictLoad({ loading: false, failed: outcome === "broken" ? "broken" : "load" });
  }

  function status() {
    if (save.state === "saving") return <span className="text-ink-2">{t.editor.saving}</span>;
    if (save.state === "offline" || save.state === "failed") {
      return (
        <span className="text-danger">
          {save.state === "offline" ? t.editor.offline : t.editor.failed}{" "}
          <button type="button" onClick={() => void store()} className="font-medium underline">{t.editor.tryAgain}</button>
        </span>
      );
    }
    if (save.state === "trashed") return <span className="text-danger">{t.editor.trashed}</span>;
    if (dirty) return <span className="text-edit">● {t.editor.unsaved}</span>;
    if (save.state === "saved") return <span className="text-ink-2">{fill(t.editor.savedAt, { time: clockTime(save.at, locale) })}</span>;
    return null;
  }

  // "Still finding the values…" goes as soon as the detection has finished.
  const current = notice?.wait && !detectRunning ? null : notice;
  const shownNotice: { id: number; kind: "status" | "alert"; text: string } | null =
    current?.kind === "alert" ? { id: current.id, kind: "alert", text: current.text(t) } : drawing ? { id: 0, kind: "status", text: t.editor.drawHint } : current ? { id: current.id, kind: "status", text: current.text(t) } : null;
  const errorText = loadError === "font" ? t.editor.fontFailed : loadError === "size" ? t.editor.sizeMismatch : t.sheet.loadError;

  return (
    <section aria-label={name} data-wide data-editor-root data-reader-state={reader.state} className="flex h-[calc(100dvh-7rem)] min-h-[32rem] flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/sheets" className="text-sm text-ink-2 hover:text-ink">← {t.sheet.back}</Link>
        <NameField key={nameKey} name={name} onRename={rename} />
        <div role="status" aria-live="polite" className="text-sm">{status()}</div>
        <button
          type="button"
          ref={drawButton}
          onClick={() => { closeMatch(); if (drawing) endDraw(); else { setDrawing(true); setDrawn(null); } }}
          aria-pressed={drawing}
          aria-keyshortcuts="K"
          disabled={!loaded || detectRunning}
          className={"ml-auto rounded-md border px-3 py-2 text-sm " + (drawing ? "border-mark bg-mark/10 text-ink" : "border-line")}
        >
          {t.editor.drawBox} <kbd aria-hidden className="ml-1 font-sans text-xs">K</kbd>
        </button>
        <ExportMenu
          disabled={!loaded}
          onChoose={(format) => {
            closeMatch();
            if (drawingRef.current) endDraw();
            setActiveId(null);
            exportOpenRef.current = true;
            setExporting({ format, busy: false, failed: false });
          }}
        />
        <button
          type="button"
          onClick={() => void store()}
          disabled={!loaded || !dirty || save.state === "saving"}
          aria-keyshortcuts="Control+S"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {t.editor.save} <kbd aria-hidden className="ml-1 font-sans text-xs">Ctrl S</kbd>
        </button>
      </header>
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div role="status" aria-live="polite" className="sr-only">{!loadError && !loaded ? t.sheet.loading : ""}</div>
          <div role="status" aria-live="polite" className="sr-only">{shownNotice?.kind === "status" ? shownNotice.text : ""}</div>
          {shownNotice ? (
            <p key={shownNotice.id} data-notice-id={shownNotice.id} role={shownNotice.kind === "alert" ? "alert" : undefined} className={"mb-2 rounded-md px-3 py-1.5 text-sm " + (shownNotice.kind === "alert" ? "bg-danger-soft" : "bg-sunk text-ink-2")}>
              {shownNotice.text}
            </p>
          ) : null}
          {match ? (
            <MatchPrompt oldValue={match.oldValue} count={match.ids.length} onApply={applyMatches} onSkip={() => closeMatch()} />
          ) : null}
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-line">
          {loadError ? (
            <p role="alert" className="m-4 rounded-md bg-danger-soft px-3 py-2 text-sm">{errorText}</p>
          ) : !loaded ? (
            <p aria-hidden className="m-4 text-sm text-ink-2">{t.sheet.loading}</p>
          ) : (
            <SheetCanvas
              base={loaded.base}
              pageW={W}
              pageH={H}
              metrics={loaded.metrics}
              name={name}
              detections={detections}
              edits={edits}
              activeId={activeId}
              scale={scale}
              onFitScale={onFitScale}
              onOpen={open}
              onPageClick={(p) => void readAt(p)}
              pendingRect={drawn}
              drawing={drawing && !drawn}
              onDrawn={onDrawn}
            >
              {popover}
              {angleDialog}
            </SheetCanvas>
          )}
          </div>
        </div>
        <div className="w-72 shrink-0">
          <ValueList detections={detections} edits={edits} activeId={activeId} detect={detect} showHint={!!loaded && detect !== "running"} onOpen={(id) => open(id, "row")} />
        </div>
      </div>
      <footer className="flex flex-wrap items-center gap-4 text-xs text-ink-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom(zoomOut(scale))} aria-label={t.editor.zoom.out} aria-keyshortcuts="-" className="rounded border border-line px-2 py-0.5">−</button>
          <span className="w-28 text-center font-mono">{fill(t.editor.zoom.level, { pct: Math.round(scale * 100) })}</span>
          <button type="button" onClick={() => setZoom(zoomIn(scale))} aria-label={t.editor.zoom.in} aria-keyshortcuts="+" className="rounded border border-line px-2 py-0.5">+</button>
          <button type="button" onClick={() => setZoom("fit")} aria-keyshortcuts="0" className="rounded border border-line px-2 py-0.5">{t.editor.zoom.fit}</button>
        </div>
        <span className="font-mono">{fill(t.editor.image, { w: W, h: H })}</span>
        {sheet.lowRes ? <span className="rounded bg-warn-soft px-2 py-0.5 text-ink">{t.editor.lowRes}</span> : null}
        <span className="ml-auto">{t.editor.keys}</span>
      </footer>
      {exporting ? (
        <ExportDialog
          format={exporting.format}
          items={exportItems}
          suggestions={exportSuggestionList}
          dirty={dirty}
          busy={exporting.busy}
          failed={exporting.failed}
          onApplySuggestion={applySuggestion}
          onExport={() => void runExport()}
          onClose={() => setExporting(null)}
        />
      ) : null}
      {conflict ? (
        <ConflictDialog byName={conflict.byName} savedAt={conflict.savedAt} loading={conflictLoad.loading} failed={conflictLoad.failed} onLoad={() => void loadLatest()} onStay={() => setConflict(null)} />
      ) : null}
    </section>
  );
}
