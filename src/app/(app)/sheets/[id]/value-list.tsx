"use client";

import { readingOrder } from "@/editor/geometry";
import type { Detection, Edit } from "@/editor/types";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";

export type DetectState = "idle" | "running" | "none" | "ocr_load" | "ocr_unsupported" | "ocr_scan";

type Props = {
  detections: readonly Detection[];
  edits: readonly Edit[];
  activeId: string | null;
  detect: DetectState;
  showHint?: boolean;
  onOpen: (id: string) => void;
};

/** The side list (Figure 8.1): every value in reading order, with its state. Keyboard users use the markers. */
export function ValueList({ detections, edits, activeId, detect, showHint, onOpen }: Props) {
  const t = useMessages();
  const v = t.editor.values;
  const byId = new Map(edits.map((e) => [e.detectionId, e]));
  return (
    <aside aria-labelledby="values-title" className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-3 py-2">
        <h2 id="values-title" className="text-sm font-bold">{v.title}</h2>
        {detections.length > 0 && <p className="text-xs text-ink-2">{fill(v.count, { n: detections.length })}</p>}
      </div>
      <div role="status" aria-live="polite" className="text-sm">
        {detect === "running" ? <p className="px-3 py-2 text-ink-2">{t.editor.detecting}</p> : null}
        {detect === "none" ? <p className="px-3 py-2">{t.editor.noValues}</p> : null}
      </div>
      {detect === "ocr_load" || detect === "ocr_unsupported" || detect === "ocr_scan" ? (
        <p role="alert" className="mx-3 my-2 rounded-md bg-danger-soft px-3 py-2 text-sm">
          {detect === "ocr_load" ? t.editor.ocrLoad : detect === "ocr_unsupported" ? t.editor.ocrUnsupported : t.editor.ocrScan}
        </p>
      ) : null}
      <ul className="flex-1 overflow-auto py-1">
        {readingOrder(detections).map((d) => {
          const edit = byId.get(d.id);
          const active = activeId === d.id;
          return (
            <li key={d.id}>
              <button
                type="button"
                tabIndex={-1}
                data-value-row={d.id}
                onClick={() => onOpen(d.id)}
                className={"flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-sunk " + (active ? "bg-accent-soft" : "")}
              >
                <span className="font-mono">{edit ? `${edit.oldValue} → ${edit.newValue}` : (d.readValue ?? "?")}</span>
                <span className={"rounded px-1.5 py-0.5 text-xs " + (edit ? "bg-edit text-white" : active ? "bg-mark text-white" : "bg-sunk text-ink-2")}>
                  {edit ? `✓ ${v.edited}` : active ? v.editing : v.sources[d.source]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {showHint ? <p className="border-t border-line px-3 py-2 text-xs text-ink-2">{t.editor.missingHint}</p> : null}
    </aside>
  );
}
