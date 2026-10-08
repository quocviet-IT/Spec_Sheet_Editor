"use client";

import { useEffect, useRef, useState } from "react";
import type { SourceType } from "@/lib/form/template";
import { drawRaster, renderSource, trimPage } from "@/lib/page/render";
import { useMessages } from "@/messages/client";

/** Renders the original exactly as the upload did (same render and trim), on white (section 8.1). */
export function SheetPreview({ sourceUrl, sourceType, name, pageW, pageH }: { sourceUrl: string; sourceType: SourceType; name: string; pageW: number; pageH: number }) {
  const t = useMessages();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(sourceUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const page = await renderSource(await response.blob(), sourceType);
        if (cancelled || !canvas.current) return;
        const { raster: trimmed } = trimPage(page);
        // M4 turns this into a hard check; for now a mismatch with the stored size is only reported.
        if (trimmed.width !== pageW || trimmed.height !== pageH) {
          console.warn(`Sheet preview size ${trimmed.width}x${trimmed.height} differs from the stored ${pageW}x${pageH}`);
        }
        drawRaster(canvas.current, trimmed);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [sourceUrl, sourceType, pageW, pageH]);

  return (
    <div className="rounded-lg border border-line bg-sunk p-4" aria-busy={state === "loading"}>
      {state === "loading" && <p role="status" className="text-sm text-ink-2">{t.sheet.loading}</p>}
      {state === "error" && <p role="alert" className="text-sm">{t.sheet.loadError}</p>}
      <canvas ref={canvas} role="img" aria-label={name} className={"mx-auto block h-auto max-w-full bg-white shadow " + (state === "ready" ? "" : "hidden")} />
    </div>
  );
}
