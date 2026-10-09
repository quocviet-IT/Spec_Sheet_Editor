"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import type { Suggestion } from "@/editor/export-plan";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";

type Item = { id: string; oldValue: string; newValue: string; panel: string };

type Props = {
  format: "png" | "pdf";
  items: Item[];
  suggestions: Suggestion[];
  dirty: boolean;
  busy: boolean;
  failed: boolean;
  onApplySuggestion: (s: Suggestion) => void;
  onExport: () => void;
  onClose: () => void;
};

/** S5 (UC-09, UC-10): what the file will show, checked before it is made. */
export function ExportDialog({ format, items, suggestions, dirty, busy, failed, onApplySuggestion, onExport, onClose }: Props) {
  const t = useMessages();
  const e = t.editor.export;
  const id = useId();
  const start = useRef<HTMLButtonElement | null>(null);
  const section = useRef<HTMLElement | null>(null);
  const label = format === "pdf" ? "PDF" : "PNG";

  useEffect(() => {
    const opener = document.activeElement;
    start.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Focus never drops to the page behind while every button is disabled.
  useEffect(() => {
    if (busy) section.current?.focus();
    else if (failed) start.current?.focus();
  }, [busy, failed]);

  // A suggestion that was applied takes its button away; focus stays inside the dialog.
  const suggestionCount = suggestions.length;
  useEffect(() => {
    if (!section.current?.contains(document.activeElement)) start.current?.focus();
  }, [suggestionCount]);

  // Escape closes the dialog wherever focus is, unless the file is being made.
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });
  useEffect(() => {
    function onEscape(ev: globalThis.KeyboardEvent) {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      if (busyRef.current) return;
      closeRef.current();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  function onKeyDown(ev: KeyboardEvent<HTMLElement>) {
    if (ev.key !== "Tab") return;
    const buttons = Array.from(ev.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    ev.preventDefault();
    if (buttons.length === 0) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + (ev.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) ev.preventDefault(); // a press on the backdrop keeps focus in the dialog
      }}
    >
      <section
        ref={section}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onKeyDown={onKeyDown}
        className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-lg bg-surface p-6 text-ink shadow-xl outline-none"
      >
        <h2 id={`${id}-title`} className="text-lg font-bold">{fill(e.title, { format: label })}</h2>
        {items.length === 0 ? (
          <p className="text-sm">{e.noEdits}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {items.map((item) => (
              <li key={item.id}>{fill(e.edited, { old: item.oldValue, new: item.newValue, panel: item.panel })}</li>
            ))}
          </ul>
        )}
        {dirty ? <p className="rounded-md bg-warn-soft px-3 py-2 text-sm">{e.unsaved}</p> : null}
        {suggestions.map((s) => (
          <div key={`${s.oldValue}>${s.newValue}`} className="flex flex-wrap items-center gap-2 rounded-md bg-sunk px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">{fill(e.suggestion, { old: s.oldValue, n: s.ids.length })}</span>
            <button type="button" disabled={busy} onClick={() => onApplySuggestion(s)} className="rounded-md border border-line px-3 py-1 disabled:opacity-50">{e.applyThere}</button>
          </div>
        ))}
        <p className="text-sm text-ink-2">{e.reminder}</p>
        {failed ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm">{e.failed}</p> : null}
        <div role="status" aria-live="polite" className="min-h-5 text-sm text-ink-2">{busy ? e.working : ""}</div>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50">{e.back}</button>
          <button ref={start} type="button" disabled={busy} aria-busy={busy} onClick={onExport} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50">{fill(e.start, { format: label })}</button>
        </div>
      </section>
    </div>
  );
}
