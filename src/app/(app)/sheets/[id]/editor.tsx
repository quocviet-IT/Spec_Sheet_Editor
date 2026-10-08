"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { loadArimo, type FontMetrics } from "@/editor/canvas";
import { detectValues, type LoadedPage } from "@/editor/detections";
import { sameSize } from "@/editor/geometry";
import type { Detection, Edit } from "@/editor/types";
import { zoomIn, zoomOut, type Zoom } from "@/editor/zoom";
import { OcrClient } from "@/lib/ocr/client";
import { drawRaster, renderSource, trimPage, type RenderedPage } from "@/lib/page/render";
import { useLocale, useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import { loadEditorState, saveSheet } from "@/sheets/actions";
import { clockTime } from "@/sheets/format";
import type { EditorSheet, SaveResult } from "@/sheets/types";
import { SheetCanvas } from "./sheet-canvas";
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [fitScale, setFitScale] = useState(0.25);
  const ocr = useRef<OcrClient | null>(null); // kept for read on click (M4b)
  const inFlight = useRef(false);
  const alive = useRef(true);
  /** The latest lists and version, for saves started from listeners and after awaits. */
  const latest = useRef({ detections: sheet.detections, edits: sheet.edits, version: sheet.version, saved: snapshot(sheet.detections, sheet.edits) });

  useEffect(() => {
    latest.current = { ...latest.current, detections, edits, saved: savedSnapshot };
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const dirty = snapshot(detections, edits) !== savedSnapshot;
  const scale = zoom === "fit" ? fitScale : zoom;
  const onFitScale = useCallback((s: number) => setFitScale(s), []);

  /** Take what the database holds (after a conflict, or when someone else stored the first detection). */
  const reloadLatest = useCallback(async () => {
    let state: Awaited<ReturnType<typeof loadEditorState>> | undefined;
    try {
      state = await loadEditorState(sheet.id);
    } catch {
      if (alive.current) setSave({ state: "offline" });
      return;
    }
    if (!alive.current) return;
    if (!state || "error" in state) {
      setSave({ state: "failed" });
      return;
    }
    const saved = snapshot(state.detections, state.edits);
    latest.current = { detections: state.detections, edits: state.edits, version: state.version, saved };
    setDetections(state.detections);
    setEdits(state.edits);
    setSavedSnapshot(saved);
    setActiveId(null);
    setDetect(state.detections.length === 0 ? "none" : "idle");
    setSave({ state: state.deleted ? "trashed" : "idle" });
  }, [sheet.id]);

  /**
   * UC-08: save the lists with the version this screen holds. Nothing happens while a save is running
   * or when nothing changed, unless `force` (the first detection is stored even when it found nothing,
   * so the sheet is not scanned again).
   */
  const store = useCallback(
    async (force = false) => {
      const sent = latest.current;
      if (inFlight.current || (!force && snapshot(sent.detections, sent.edits) === sent.saved)) return;
      inFlight.current = true;
      setSave({ state: "saving" });
      let result: SaveResult | undefined;
      try {
        result = await saveSheet({ id: sheet.id, version: sent.version, detections: sent.detections, edits: sent.edits });
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
        latest.current = { ...latest.current, version: result.version, saved };
        setSavedSnapshot(saved);
        setSave({ state: "saved", at: result.savedAt });
        return;
      }
      if (result.error === "conflict") {
        if (force) {
          await reloadLatest(); // someone else stored the first detection; take theirs
          return;
        }
        setSave({ state: "idle" }); // Task 9 shows the conflict dialog here
        return;
      }
      setSave({ state: result.error === "trashed" ? "trashed" : "failed" });
    },
    [sheet.id, reloadLatest],
  );

  // Load the page and the font; on the first open, detect and store the values (UC-04).
  useEffect(() => {
    let cancelled = false;
    let client = null as OcrClient | null; // assigned inside the factory below; the cast stops TS narrowing it to never
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
        if (!cancelled) setLoadError("load");
        return;
      }
      let metrics: FontMetrics;
      try {
        metrics = await font;
      } catch {
        if (!cancelled) setLoadError("font");
        return;
      }
      if (cancelled) return;
      const trimmed = trimPage(rendered);
      if (!sameSize(trimmed.raster.width, trimmed.raster.height, sheet.pageW, sheet.pageH)) {
        setLoadError("size");
        return;
      }
      const base = document.createElement("canvas");
      drawRaster(base, trimmed.raster);
      const page: LoadedPage = { raster: trimmed.raster, text: rendered.text, offsetX: trimmed.offsetX, offsetY: trimmed.offsetY };
      setLoaded({ page, base, metrics });
      if (sheet.version !== 1) return;
      const result = await detectValues(page, () => (client ??= new OcrClient()));
      if (cancelled) return;
      if (!result.ok) {
        if (result.reason === "ocr_load") {
          client?.dispose(); // onnxruntime cannot initialise twice in one Worker
          client = null;
        }
        setDetect(result.reason);
        return;
      }
      ocr.current = client;
      latest.current = { ...latest.current, detections: result.detections };
      setDetections(result.detections);
      setDetect(result.detections.length === 0 ? "none" : "idle");
      await store(true);
    })();
    return () => {
      cancelled = true;
      controller.abort();
      client?.dispose();
      if (ocr.current === client) ocr.current = null;
    };
  }, [sheet, store]);

  // Ctrl+S saves (UC-08); + / − / 0 zoom (section 8.4) unless typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void store();
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
  }, [store, scale]);

  const W = loaded?.page.raster.width ?? sheet.pageW;
  const H = loaded?.page.raster.height ?? sheet.pageH;

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
    <section aria-label={sheet.name} className="flex h-[calc(100vh-7rem)] min-h-[32rem] flex-col gap-3">
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
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-line">
          {loadError ? (
            <p role="alert" className="m-4 rounded-md bg-danger-soft px-3 py-2 text-sm">{errorText}</p>
          ) : !loaded ? (
            <p role="status" className="m-4 text-sm text-ink-2">{t.sheet.loading}</p>
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
              onOpen={setActiveId}
            />
          )}
        </div>
        <div className="w-72 shrink-0">
          <ValueList detections={detections} edits={edits} activeId={activeId} detect={detect} onOpen={setActiveId} />
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
    </section>
  );
}
