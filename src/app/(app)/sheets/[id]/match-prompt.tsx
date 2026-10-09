"use client";

import { useEffect, useId, useRef } from "react";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";

/** UC-05 extension 5a: offer the same change where the same old value still shows. */
export function MatchPrompt({ oldValue, count, onApply, onSkip }: { oldValue: string; count: number; onApply: () => void; onSkip: () => void }) {
  const t = useMessages();
  const m = t.editor.matching;
  const id = useId();
  const apply = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    apply.current?.focus();
  }, []);

  return (
    <section
      role="dialog"
      data-match-prompt
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onSkip();
        }
      }}
      className="absolute left-1/2 top-3 z-30 w-96 -translate-x-1/2 space-y-3 rounded-lg border border-line bg-surface p-4 text-ink shadow-lg"
    >
      <h2 id={`${id}-title`} className="font-bold">{m.title}</h2>
      <p id={`${id}-body`} className="text-sm">{fill(m.body, { old: oldValue, n: count })}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onSkip} className="rounded-md border border-line px-3 py-2 text-sm">{m.skip}</button>
        <button ref={apply} type="button" onClick={onApply} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink">{m.apply}</button>
      </div>
    </section>
  );
}
