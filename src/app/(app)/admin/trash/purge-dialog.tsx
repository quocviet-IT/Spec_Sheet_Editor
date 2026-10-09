"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { purgeTrashed } from "@/admin/trash-actions";
import type { TrashRow } from "@/admin/queries";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import { Thumb } from "./trash-table";

/** UC-17 step 2: the Delete button stays disabled until the sheet's exact name is retyped (BR-16). */
export function PurgeDialog({ row, onClose, onDone }: { row: TrashRow; onClose: () => void; onDone: (notice: string) => void }) {
  const t = useMessages();
  const a = t.admin.trash;
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });
  useEffect(() => {
    input.current?.focus();
    function onEscape(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (!busyRef.current) closeRef.current();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "Tab") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
    const i = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
  }

  const matches = typed === row.name;

  async function submit() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    let result: Awaited<ReturnType<typeof purgeTrashed>>;
    try {
      result = await purgeTrashed({ id: row.id, typedName: typed });
    } catch {
      result = { error: "failed" };
    }
    setBusy(false);
    if ("ok" in result) {
      onDone(fill(a.deleted, { name: result.name }));
      onClose();
      return;
    }
    const e = result.error;
    if (e === "files_left") {
      // The record is gone; the orphan clean-up removes what is left.
      onDone(a.errors.filesLeft);
      onClose();
      return;
    }
    setError(
      e === "not_in_trash" ? a.errors.notInTrash
        : e === "not_found" ? a.errors.notFound
        : e === "name_mismatch" ? a.errors.mismatch
        : e === "forbidden" ? t.admin.users.errors.forbidden
        : a.errors.failed,
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <section
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-warning`}
        onKeyDown={onKeyDown}
        className="w-full max-w-md space-y-4 rounded-lg bg-surface p-6 text-ink shadow-xl outline-none"
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold">{a.dialogTitle}</h2>
        <div className="flex items-center gap-3">
          <Thumb url={row.thumbUrl} className="h-20 w-16" />
          <p className="break-words font-medium">{row.name}</p>
        </div>
        <p id={`${id}-warning`} className="text-sm">{a.warning}</p>
        <div className="space-y-1">
          <label htmlFor={`${id}-name`} className="block text-sm font-medium">{a.retype}</label>
          <input
            ref={input}
            id={`${id}-name`}
            value={typed}
            onChange={(e) => { setTyped(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
          />
        </div>
        {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50">{a.cancel}</button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!matches || busy}
            aria-busy={busy}
            className="rounded-md bg-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? a.deleting : a.deleteForever}
          </button>
        </div>
      </section>
    </div>
  );
}
