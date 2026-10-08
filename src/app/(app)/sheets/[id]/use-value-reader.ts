"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ocrFailureReason, type ReaderFailure } from "@/editor/detections";
import { DEFAULT_MODELS, OcrClient } from "@/lib/ocr/client";
import type { Raster } from "@/lib/ocr/raster";

export type ReaderState = "idle" | "loading" | "ready" | ReaderFailure;

/**
 * The page's OCR reader (UC-04 scan, UC-06 read on click): started once, on first need, with the models
 * loaded and the page set; stopped when the page closes. A start that failed is forgotten, so the next
 * need tries again with a new Worker (onnxruntime cannot initialise twice in one Worker). `ensure` takes
 * the page raster, because the first detection asks for the reader in the same tick the page is loaded.
 */
export function useValueReader(): { state: ReaderState; ensure: (page: Raster) => Promise<OcrClient> } {
  const client = useRef<OcrClient | null>(null);
  const starting = useRef<Promise<OcrClient> | null>(null);
  const alive = useRef(true);
  const [state, setState] = useState<ReaderState>("idle");

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      client.current?.dispose();
      client.current = null;
      starting.current = null;
    };
  }, []);

  const ensure = useCallback((page: Raster): Promise<OcrClient> => {
    if (starting.current) return starting.current;
    setState("loading");
    const start = (async () => {
      const fresh = new OcrClient(); // inside the async function: a Worker that cannot be built rejects
      try {
        await fresh.init({ det: DEFAULT_MODELS.det, rec: DEFAULT_MODELS.rec, keys: DEFAULT_MODELS.keys });
        await fresh.setPage(page);
      } catch (error) {
        fresh.dispose();
        throw error;
      }
      if (!alive.current) {
        fresh.dispose();
        throw new Error("The page was closed.");
      }
      client.current = fresh;
      setState("ready");
      return fresh;
    })();
    starting.current = start;
    start.catch((error: unknown) => {
      if (starting.current === start) starting.current = null;
      if (alive.current) setState(ocrFailureReason(error));
    });
    return start;
  }, []);

  return { state, ensure };
}
