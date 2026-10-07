"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_MODELS, OcrClient } from "@/lib/ocr/client";
import type { InitResult } from "@/lib/ocr/protocol";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function Bench() {
  const client = useRef<OcrClient | null>(null);
  const [init, setInit] = useState<InitResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One Worker per visit; loading models again reuses it (the Worker releases the old sessions).
  useEffect(() => {
    const ocr = new OcrClient();
    client.current = ocr;
    return () => {
      client.current = null;
      void ocr.dispose();
    };
  }, []);

  async function loadModels() {
    setBusy("Loading models");
    setError(null);
    setInit(null);
    try {
      const ocr = client.current;
      if (!ocr) throw new Error("The OCR worker is not running.");
      setInit(await ocr.init({ ...DEFAULT_MODELS }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">OCR bench</h1>
      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-semibold">Models</h2>
        <button
          type="button"
          onClick={loadModels}
          disabled={busy !== null}
          className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
        >
          Load models
        </button>
        {init && (
          <p className="font-mono text-sm">
            threads {init.numThreads} · cross-origin isolated {String(init.crossOriginIsolated)} · classes {init.classes} ·
            load {seconds(init.loadMs)} · warm-up {seconds(init.warmupMs)}
          </p>
        )}
      </section>
      {busy && <p role="status">{busy}…</p>}
      {error && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
          {error}
        </p>
      )}
    </main>
  );
}
