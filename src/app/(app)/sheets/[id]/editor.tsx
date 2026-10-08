"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { loadArimo, type FontMetrics } from "@/editor/canvas";
import { detectValues, makeEdit, ocrFailureReason, toDetection, type LoadedPage } from "@/editor/detections";
import { boxFromQuad, detectionAt, pointInDrawingArea, sameSize, toPx } from "@/editor/geometry";
import type { Detection, Edit } from "@/editor/types";
import { zoomIn, zoomOut, type Zoom } from "@/editor/zoom";
import type { OcrClient } from "@/lib/ocr/client";
import type { Point } from "@/lib/ocr/geometry";
import { drawRaster, renderSource, trimPage, type RenderedPage } from "@/lib/page/render";
import { useLocale, useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import { loadEditorState, saveSheet } from "@/sheets/actions";
import { clockTime } from "@/sheets/format";
import type { EditorSheet, SaveResult } from "@/sheets/types";
import { ConflictDialog } from "./conflict-dialog";
import { EditPopover } from "./edit-popover";
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

const POPOVER_W = 320;
const POPOVER_GAP = 12;

/** Beside the marker, on the right when it fits inside the page, otherwise on the left. */
function popoverPlace(d: Detection, pageW: number, pageH: number, scale: number): CSSProperties {
  const px = toPx(d.box, d.angle, pageW, pageH);
  const reach = (Math.hypot(px.w, px.h) / 2) * scale + POPOVER_GAP;
  const x = px.cx * scale;
  const y = px.cy * scale;
  const left = x + reach + POPOVER_W <= pageW * scale ? x + reach : Math.max(0, x - reach - POPOVER_W);
  return { left, top: Math.max(0, y - 24) };
}

/** Edits compared by value, not by the order they were applied in. */
function snapshot(detections: readonly Detection[], edits: readonly Edit[]): string {
  return JSON.stringify({ detections, edits: [...edits].sort((a, b) => (a.detectionId < b.detectionId ? -1 : 1)) });
}

function EditorBody({ sheet }: { sheet: EditorSheet }) {
  const t = useMessages();
  const locale = useLocale();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [detections, setDetections] = useState<Detection[]>(sheet.detections);
  const [edits, setEdits] = useState<Edit[]>(sheet.edits);
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(sheet.detections, sheet.edits));
  const [detect, setDetect] = useState<DetectState>(sheet.version === 1 ? "running" : sheet.detections.length === 0 ? "none" : "idle");
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const [firstStore, setFirstStore] = useState(false);
  const [conflict, setConflict] = useState<{ byName: string | null; savedAt: string | null } | null>(null);
  const [conflictLoad, setConflictLoad] = useState({ loading: false, failed: false });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [fitScale, setFitScale] = useState(0.25);
  const reader = useValueReader();
  const ensureReader = useRef(reader.ensure);
  const [notice, setNotice] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const readingNow = useRef(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  /** The latest lists and version, for saves started from listeners and after awaits. */
  const latest = useRef({ detections: sheet.detections, edits: sheet.edits, version: sheet.version, name: sheet.name, saved: snapshot(sheet.detections, sheet.edits), firstStore: false });

  useEffect(() => {
    latest.current = { ...latest.current, detections, edits, saved: savedSnapshot, firstStore };
    ensureReader.current = reader.ensure;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const dirty = snapshot(detections, edits) !== savedSnapshot || firstStore;
  const conflictOpen = conflict !== null;
  const scale = zoom === "fit" ? fitScale : zoom;
  const onFitScale = useCallback((s: number) => setFitScale(s), []);

  /** Take what the database holds (after a conflict, or when someone else stored the first detection). */
  const reloadLatest = useCallback(async (): Promise<boolean> => {
    let state: Awaited<ReturnType<typeof loadEditorState>> | undefined;
    try {
      state = await loadEditorState(sheet.id);
    } catch {
      if (alive.current) setSave({ state: "offline" });
      return false;
    }
    if (!alive.current) return false;
    if (!state || "error" in state) {
      setSave({ state: "failed" });
      return false;
    }
    const saved = snapshot(state.detections, state.edits);
    latest.current = { detections: state.detections, edits: state.edits, version: state.version, name: state.name, saved, firstStore: false };
    setFirstStore(false);
    setConflict(null);
    setDetections(state.detections);
    setEdits(state.edits);
    setSavedSnapshot(saved);
    setActiveId(null);
    setDetect(state.detections.length === 0 ? "none" : "idle");
    setSave({ state: state.deleted ? "trashed" : "idle" });
    return true;
  }, [sheet.id]);

  /**
   * UC-08: save the lists with the version this screen holds. Nothing happens while a save is running
   * or when nothing changed, unless this is the first store of a detection (stored even when it found
   * nothing, so the sheet is not scanned again; it stays pending until it succeeds).
   */
  const store = useCallback(
    async () => {
      const sent = latest.current;
      const force = sent.firstStore;
      if (inFlight.current || (!force && snapshot(sent.detections, sent.edits) === sent.saved)) return;
      inFlight.current = true;
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
        const saved = snapshot(sent.detections, sent.edits);
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
        setConflictLoad({ loading: false, failed: false });
        setConflict({ byName: result.byName, savedAt: result.savedAt });
        setSave({ state: "idle" });
        return;
      }
      setSave({ state: result.error === "trashed" ? "trashed" : "failed" });
    },
    [sheet.id, reloadLatest],
  );

  // Load the page and the font; on the first open, detect and store the values (UC-04).
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const font = loadArimo();
    font.catch(() => {}); // handled below; avoids an unhandled rejection when the page fails first
    (async () => {
      let rendered: RenderedPage;
      try {
        const response = await fetch(sheet.sourceUrl ?? "", { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        rendered = await renderSource(await response.blob(), sheet.sourceType);
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
      if (!sameSize(trimmed.raster.width, trimmed.raster.height, sheet.pageW, sheet.pageH)) {
        setLoadError("size");
        setDetect("idle");
        return;
      }
      const canvas = document.createElement("canvas");
      drawRaster(canvas, trimmed.raster);
      const page: LoadedPage = { raster: trimmed.raster, text: rendered.text, offsetX: trimmed.offsetX, offsetY: trimmed.offsetY };
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
      await store();
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sheet.id, sheet.sourceUrl, sheet.sourceType, sheet.pageW, sheet.pageH, store]);

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
        if (!conflictOpen) void store();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "+" || e.key === "=") setZoom(zoomIn(scale));
      else if (e.key === "-") setZoom(zoomOut(scale));
      else if (e.key === "0") setZoom("fit");
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, scale, conflictOpen]);

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

  function focusMarker(id: string) {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-detection="${CSS.escape(id)}"]`)?.focus());
  }

  function closePopover(id: string) {
    setActiveId(null);
    focusMarker(id);
  }

  function apply(detection: Detection, oldValue: string, newValue: string) {
    if (!loaded) return;
    const edit = makeEdit(loaded.page.raster, detection, oldValue, newValue);
    setEdits((list) => [...list.filter((e) => e.detectionId !== detection.id), edit]);
    closePopover(detection.id);
  }

  function revert(id: string) {
    setEdits((list) => list.filter((e) => e.detectionId !== id));
    closePopover(id);
  }

  function open(id: string) {
    setNotice(null);
    setActiveId(id);
    requestAnimationFrame(() =>
      document.querySelector(`[data-detection="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    );
  }

  async function readAt(p: Point) {
    if (!loaded || readingNow.current || !pointInDrawingArea(p, W, H)) return;
    if (detect === "running") {
      setNotice({ kind: "status", text: t.editor.waitDetect });
      return;
    }
    readingNow.current = true;
    setNotice({ kind: "status", text: reader.state === "ready" ? t.editor.reading : t.editor.readerLoading });
    try {
      let client: OcrClient;
      try {
        client = await reader.ensure(loaded.page.raster);
      } catch (error) {
        if (alive.current) setNotice({ kind: "alert", text: ocrFailureReason(error) === "ocr_unsupported" ? t.editor.ocrUnsupported : t.editor.ocrLoad });
        return;
      }
      if (alive.current) setNotice({ kind: "status", text: t.editor.reading });
      const result = await client.read(p).catch(() => null);
      if (!alive.current) return;
      const r = result?.reading ?? null;
      const px = r ? boxFromQuad(r.quad, r.angle) : null;
      if (!r || !px || !pointInDrawingArea({ x: px.cx, y: px.cy }, W, H)) {
        setNotice({ kind: "alert", text: t.editor.clickNoRead });
        return;
      }
      setNotice(null);
      const hit = detectionAt(latest.current.detections, { x: px.cx, y: px.cy }, W, H);
      if (hit) {
        open(hit.id);
        return;
      }
      const added = toDetection(loaded.page.raster, px, { readValue: r.value, confidence: Math.round(r.score * 100), source: "click" }, () => crypto.randomUUID());
      latest.current = { ...latest.current, detections: [...latest.current.detections, added] };
      setDetections((list) => [...list, added]);
      open(added.id);
    } finally {
      readingNow.current = false;
    }
  }

  const active = loaded && activeId ? detections.find((d) => d.id === activeId) ?? null : null;
  const popover = active ? (
    <EditPopover
      key={active.id}
      detection={active}
      edit={edits.find((e) => e.detectionId === active.id) ?? null}
      style={popoverPlace(active, W, H, scale)}
      onApply={(oldValue, newValue) => apply(active, oldValue, newValue)}
      onRevert={() => revert(active.id)}
      onClose={(refocus) => (refocus ? closePopover(active.id) : setActiveId(null))}
    />
  ) : null;

  async function loadLatest() {
    setConflictLoad({ loading: true, failed: false });
    const ok = await reloadLatest();
    if (alive.current && !ok) setConflictLoad({ loading: false, failed: true });
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

  const errorText = loadError === "font" ? t.editor.fontFailed : loadError === "size" ? t.editor.sizeMismatch : t.sheet.loadError;

  return (
    <section aria-label={sheet.name} data-wide data-reader-state={reader.state} className="flex h-[calc(100dvh-7rem)] min-h-[32rem] flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/sheets" className="text-sm text-ink-2 hover:text-ink">← {t.sheet.back}</Link>
        <h1 className="text-lg font-bold">{sheet.name}</h1>
        <div role="status" aria-live="polite" className="text-sm">{status()}</div>
        <button
          type="button"
          onClick={() => void store()}
          disabled={!loaded || !dirty || save.state === "saving"}
          aria-keyshortcuts="Control+S"
          className="ml-auto rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {t.editor.save} <kbd aria-hidden className="ml-1 font-sans text-xs opacity-75">Ctrl S</kbd>
        </button>
      </header>
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <div role="status" aria-live="polite" className="sr-only">{!loadError && !loaded ? t.sheet.loading : ""}</div>
          <div role="status" aria-live="polite" className="sr-only">{notice?.kind === "status" ? notice.text : ""}</div>
          {notice ? (
            <p role={notice.kind === "alert" ? "alert" : undefined} className={"mb-2 rounded-md px-3 py-1.5 text-sm " + (notice.kind === "alert" ? "bg-danger-soft" : "bg-sunk text-ink-2")}>
              {notice.text}
            </p>
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
              name={sheet.name}
              detections={detections}
              edits={edits}
              activeId={activeId}
              scale={scale}
              onFitScale={onFitScale}
              onOpen={open}
              onPageClick={(p) => void readAt(p)}
            >
              {popover}
            </SheetCanvas>
          )}
          </div>
        </div>
        <div className="w-72 shrink-0">
          <ValueList detections={detections} edits={edits} activeId={activeId} detect={detect} showHint={!!loaded && detect !== "running"} onOpen={open} />
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
      {conflict ? (
        <ConflictDialog byName={conflict.byName} savedAt={conflict.savedAt} loading={conflictLoad.loading} failed={conflictLoad.failed} onLoad={() => void loadLatest()} onStay={() => setConflict(null)} />
      ) : null}
    </section>
  );
}
