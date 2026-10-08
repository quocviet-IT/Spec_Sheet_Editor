"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { useLocale, useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import { clockTime } from "@/sheets/format";

type Props = {
  byName: string | null;
  savedAt: string | null;
  loading: boolean;
  failed: boolean;
  onLoad: () => void;
  onStay: () => void;
};

/** S6 (UC-08 extension 3a, BR-10): someone saved first; nothing is overwritten without a choice. */
export function ConflictDialog({ byName, savedAt, loading, failed, onLoad, onStay }: Props) {
  const t = useMessages();
  const locale = useLocale();
  const c = t.editor.conflict;
  const id = useId();
  const stay = useRef<HTMLButtonElement | null>(null);
  const load = useRef<HTMLButtonElement | null>(null);
  const section = useRef<HTMLElement | null>(null);
  const wasLoading = useRef(false);

  useEffect(() => {
    const opener = document.activeElement;
    stay.current?.focus(); // the choice that keeps the person's work
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Focus never drops to the page behind while both buttons are disabled; a failed load hands it back.
  useEffect(() => {
    if (loading) section.current?.focus();
    else if (wasLoading.current && failed) load.current?.focus();
    wasLoading.current = loading;
  }, [loading, failed]);

  // Esc means "Stay" wherever focus is.
  const stayRef = useRef(onStay);
  const loadingRef = useRef(loading);
  useEffect(() => {
    stayRef.current = onStay;
    loadingRef.current = loading;
  });
  useEffect(() => {
    function onEscape(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (loadingRef.current) return; // the latest version is on its way; staying now could not stop it
      stayRef.current();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "Tab") return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault(); // a press on the backdrop keeps focus in the dialog
      }}
    >
      <section
        ref={section}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onKeyDown={onKeyDown}
        className="w-full max-w-md space-y-4 rounded-lg bg-surface p-6 outline-none text-ink shadow-xl"
      >
        <h2 id={`${id}-title`} className="text-lg font-bold">{c.title}</h2>
        <div id={`${id}-body`} className="space-y-2 text-sm">
          <p>{fill(c.body, { name: byName ?? c.someone, time: savedAt ? clockTime(savedAt, locale) : "—" })}</p>
          <p className="text-ink-2">{c.note}</p>
        </div>
        {failed ? <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm">{c.loadFailed}</p> : null}
        <div className="flex justify-end gap-2">
          <button ref={stay} type="button" onClick={onStay} disabled={loading} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50">{c.stay}</button>
          <button ref={load} type="button" onClick={onLoad} disabled={loading} aria-busy={loading} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50">{c.load}</button>
        </div>
      </section>
    </div>
  );
}
