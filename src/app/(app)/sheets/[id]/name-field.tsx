"use client";

import { useEffect, useRef, useState } from "react";
import { useMessages } from "@/messages/client";

/** F-06: rename in the toolbar; the new name is saved with the next Save. */
export function NameField({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const t = useMessages();
  const r = t.editor.rename;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  // Set once an edit has ended, so the blur fired as the input unmounts cannot act on a stale draft.
  const done = useRef(false);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  /** `key`: ended by Enter or Escape (focus returns to the button); a blur leaves focus where the person put it. */
  function finish(keep: boolean, key: boolean) {
    if (done.current) return;
    if (keep) {
      const next = draft.trim();
      if (!next) {
        if (key) {
          setError(r.empty);
          return;
        }
        // Blur with an empty name: silently keep the old one.
      } else if (next !== name) onRename(next);
    }
    done.current = true;
    setError(null);
    setEditing(false);
    if (key) requestAnimationFrame(() => button.current?.focus());
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-lg font-bold">{name}</h1>
        <button ref={button} type="button" onClick={() => { setDraft(name); done.current = false; setEditing(true); }} className="rounded border border-line px-2 py-0.5 text-xs text-ink-2 hover:text-ink">
          {r.button}
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <div>
        <input
          ref={input}
          aria-label={r.label}
          value={draft}
          maxLength={200}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); finish(true, true); }
            if (e.key === "Escape") { e.preventDefault(); finish(false, true); }
            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
              // Save the draft with the sheet: commit it first (an empty name is refused and nothing is saved).
              if (!draft.trim()) {
                e.preventDefault();
                e.stopPropagation();
                setError(r.empty);
                return;
              }
              finish(true, true);
            }
          }}
          onBlur={() => finish(true, false)}
          aria-invalid={error !== null}
          className="w-80 rounded-md border border-line bg-surface px-2 py-1 text-lg font-bold"
        />
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
