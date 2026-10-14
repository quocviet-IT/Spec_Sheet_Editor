"use client";

import { useEffect, useRef, useState } from "react";
import { CLICK_OFFSET, editorView, SAMPLE_SIZE, SAMPLE_TRUTH, TARGETS, type BenchView } from "@/lib/ocr/bench/sample";
import { scoreClicks, scoreScan, type ClickRow } from "@/lib/ocr/bench/score";
import { DEFAULT_MODELS, OcrClient } from "@/lib/ocr/client";
import type { InitResult, ScanResult } from "@/lib/ocr/protocol";
import type { Raster } from "@/lib/ocr/raster";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const verdict = (ok: boolean) => (ok ? "PASS" : "FAIL");

async function blobToRaster(blob: Blob): Promise<Raster> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: img.width, height: img.height, data: img.data };
}

type ModelFiles = { det?: File; rec?: File; keys?: File };

export function Bench() {
  const client = useRef<OcrClient | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  /** The sample's own size, and the sample as the editor holds it (trimmed, with the frame it scans). */
  const [sampleSize, setSampleSize] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState<BenchView | null>(null);
  const [files, setFiles] = useState<ModelFiles>({});
  const [init, setInit] = useState<InitResult | null>(null);
  const [scan, setScan] = useState<{ result: ScanResult; totalMs: number } | null>(null);
  const [clicks, setClicks] = useState<ClickRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One Worker per visit; loading models again reuses it (the Worker releases the old sessions).
  useEffect(() => {
    const ocr = new OcrClient();
    client.current = ocr;
    return () => {
      client.current = null;
      ocr.dispose();
    };
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !view) return;
    const { page, frame } = view;
    el.width = page.width;
    el.height = page.height;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(page.data), page.width, page.height), 0, 0);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#2563eb";
    ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
    ctx.strokeStyle = "#16a34a";
    for (const d of scan?.result.detections ?? []) ctx.strokeRect(d.box.x, d.box.y, d.box.w, d.box.h);
    ctx.strokeStyle = "#dc2626";
    for (const r of clicks ?? []) if (r.reading) ctx.strokeRect(r.reading.box.x, r.reading.box.y, r.reading.box.w, r.reading.box.h);
  }, [view, scan, clicks]);

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function ready(): { ocr: OcrClient; view: BenchView } {
    if (!client.current || !init) throw new Error("Load the models first.");
    if (!view) throw new Error("Load the sample sheet first.");
    return { ocr: client.current, view };
  }

  const loadModels = () =>
    run("Loading models", async () => {
      const ocr = client.current;
      if (!ocr) throw new Error("The OCR worker is not running.");
      setInit(null);
      setScan(null);
      setClicks(null);
      const [det, rec, keys] = await Promise.all([files.det?.arrayBuffer(), files.rec?.arrayBuffer(), files.keys?.arrayBuffer()]);
      setInit(await ocr.init({ det: det ?? DEFAULT_MODELS.det, rec: rec ?? DEFAULT_MODELS.rec, keys: keys ?? DEFAULT_MODELS.keys }));
      if (view) await ocr.setPage(view.page);
    });

  async function showSample(blob: Blob) {
    const raster = await blobToRaster(blob);
    // The editor reads the trimmed page and scans its drawing area; the bench measures exactly that.
    const next = editorView(raster);
    await client.current?.setPage(next.page);
    setSampleSize({ width: raster.width, height: raster.height });
    setView(next);
    setScan(null);
    setClicks(null);
  }

  const pickSample = (file: File) => run("Reading the sample", () => showSample(file));

  const loadSampleFromDisk = () =>
    run("Fetching samples/sample.png", async () => {
      const response = await fetch("/dev/ocr-bench/sample", { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      await showSample(await response.blob());
    });

  const runScan = () =>
    run("Scanning the drawing area", async () => {
      const { ocr, view } = ready();
      const started = performance.now();
      const result = await ocr.scan(view.frame);
      setScan({ result, totalMs: performance.now() - started });
    });

  const runClicks = () =>
    run("Clicking the 11 values", async () => {
      const { ocr, view } = ready();
      const rows: ClickRow[] = [];
      for (const t of view.truth) {
        const res = await ocr.read({ x: t.x + CLICK_OFFSET.x, y: t.y + CLICK_OFFSET.y });
        rows.push({ key: t.key, reading: res.reading, ms: res.ms });
        setClicks([...rows]);
      }
    });

  const scanScore = scan && view ? scoreScan(scan.result.detections, view.truth) : null;
  const clickScore = clicks && view && clicks.length === SAMPLE_TRUTH.length ? scoreClicks(clicks, view.truth) : null;
  const wrongSize = sampleSize && (sampleSize.width !== SAMPLE_SIZE.width || sampleSize.height !== SAMPLE_SIZE.height);
  const button = "rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50";

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">OCR bench</h1>
        <p className="text-sm text-ink-2">
          TC-20: at least {TARGETS.scanLocated}/11 values located within {TARGETS.scanSeconds} s. TC-24: each click within{" "}
          {TARGETS.clickSeconds} s. Developer tool; the sample sheet never leaves this browser.
        </p>
      </header>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-semibold">1. Models</h2>
        <p className="text-sm text-ink-2">Default: PP-OCRv4 small from /models/ppocr-v4. To compare another model, pick all three files.</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {(["det", "rec", "keys"] as const).map((kind) => (
            <label key={kind} className="flex flex-col gap-1">
              <span>{kind === "keys" ? "Keys file (.txt)" : `${kind} model (.onnx)`}</span>
              <input type="file" accept={kind === "keys" ? ".txt" : ".onnx"} disabled={busy !== null} onChange={(e) => setFiles((f) => ({ ...f, [kind]: e.target.files?.[0] }))} />
            </label>
          ))}
        </div>
        <button type="button" onClick={loadModels} disabled={busy !== null} className={button}>
          Load models
        </button>
        {init && (
          <p className="font-mono text-sm">
            threads {init.numThreads} · cross-origin isolated {String(init.crossOriginIsolated)} · classes {init.classes} · load{" "}
            {seconds(init.loadMs)} · warm-up {seconds(init.warmupMs)}
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-semibold">2. Sample sheet</h2>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <button type="button" onClick={loadSampleFromDisk} disabled={busy !== null} className={button}>
            Load samples/sample.png
          </button>
          <label className="flex items-center gap-2">
            <span>or pick a file</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              disabled={busy !== null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void pickSample(file);
              }}
            />
          </label>
        </div>
        {sampleSize && view && (
          <p className="text-sm">
            {sampleSize.width} × {sampleSize.height} px; trimmed as in the editor to {view.page.width} × {view.page.height} px at ({view.offset.x},{" "}
            {view.offset.y}); scan frame {view.frame.w} × {view.frame.h} px at ({view.frame.x}, {view.frame.y})
            {wrongSize && ` — the truth coordinates belong to the ${SAMPLE_SIZE.width} × ${SAMPLE_SIZE.height} sample; scores will be wrong.`}
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-semibold">3. Run</h2>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={runScan} disabled={busy !== null} className={button}>
            Scan (0° and 90°)
          </button>
          <button type="button" onClick={runClicks} disabled={busy !== null} className={button}>
            Click the 11 values
          </button>
        </div>
        {scanScore && scan && (
          <p className="font-mono text-sm" data-testid="scan-summary">
            Scan: located {scanScore.located}/11 ({verdict(scanScore.located >= TARGETS.scanLocated)}), read {scanScore.read}/11, stray{" "}
            {scanScore.stray}, total {seconds(scan.totalMs)} ({verdict(scan.totalMs <= TARGETS.scanSeconds * 1000)}; 0°{" "}
            {seconds(scan.result.timing.horizontalMs)}, 90° {seconds(scan.result.timing.verticalMs)}
            {scan.result.timing.diagonalMs !== undefined && `, ±45° ${seconds(scan.result.timing.diagonalMs)}`})
          </p>
        )}
        {clickScore && (
          <p className="font-mono text-sm" data-testid="click-summary">
            Click: correct {clickScore.correct}/11, slowest {seconds(clickScore.slowestMs)} (
            {verdict(clickScore.slowestMs <= TARGETS.clickSeconds * 1000)})
          </p>
        )}
      </section>

      {busy && <p role="status">{busy}…</p>}
      {error && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {(scanScore || clicks) && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="py-1 pr-3">Value</th>
              <th className="py-1 pr-3">Expected</th>
              <th className="py-1 pr-3">Scan</th>
              <th className="py-1 pr-3">Click</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {SAMPLE_TRUTH.map((t, i) => {
              const d = scanScore?.rows[i].detection;
              const c = clicks?.[i];
              return (
                <tr key={t.key} className="border-b border-line">
                  <td className="py-1 pr-3">{t.key}</td>
                  <td className="py-1 pr-3">{t.value}</td>
                  <td className="py-1 pr-3">{d ? `${d.value} (${Math.round(d.score * 100)}%, ${d.angle}°)` : "—"}</td>
                  <td className="py-1 pr-3">
                    {c ? (c.reading ? `${c.reading.value} (${Math.round(c.reading.score * 100)}%, ${c.reading.angle}°, ${seconds(c.ms)})` : `none (${seconds(c.ms)})`) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {view && <canvas ref={canvas} className="h-auto max-w-full border border-line" aria-label="Sample sheet with the boxes found" />}
    </main>
  );
}
