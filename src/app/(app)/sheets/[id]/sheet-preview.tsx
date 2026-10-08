"use client";

import { useEffect, useRef, useState } from "react";
import type { SourceType } from "@/lib/form/template";
import { drawRaster, renderSource, trimPage } from "@/lib/page/render";
import { useMessages } from "@/messages/client";

/** Renders the original exactly as the upload did (same render and trim), on white (section 8.1). */
export function SheetPreview({ sourceUrl, sourceType }: { sourceUrl: string; sourceType: SourceType }) {
  const t = useMessages();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const page = await renderSource(await response.blob(), sourceType);
        if (cancelled || !canvas.current) return;
        drawRaster(canvas.current, trimPage(page));
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [sourceUrl, sourceType]);

  return (
    <div className="rounded-lg border border-line bg-sunk p-4">
      {state === "loading" && <p className="text-sm text-ink-2">{t.sheet.loading}</p>}
      {state === "error" && <p role="alert" className="text-sm">{t.sheet.loadError}</p>}
      <canvas ref={canvas} className={"mx-auto block h-auto max-w-full bg-white shadow " + (state === "ready" ? "" : "hidden")} />
    </div>
  );
}
