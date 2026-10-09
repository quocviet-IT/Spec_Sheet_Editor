"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { decimalsOf, normalizeNewValue, normalizeOldValue } from "@/editor/numbers";
import type { Detection, Edit } from "@/editor/types";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";

type Props = {
  detection: Detection;
  edit: Edit | null;
  style: CSSProperties;
  onApply: (oldValue: string, newValue: string) => void;
  onRevert: () => void;
  /** `refocus` is false when the person pressed somewhere else: focus then stays where they pressed. */
  onClose: (refocus: boolean) => void;
};

const INTERACTIVE = "button, a[href], input, select, textarea, [role='button'], [data-detection]";

/**
 * Stops the click that completes the press which closed the popover. It goes away with the next press
 * (a drag makes no click) or after one click, whichever comes first.
 */
function swallowNextClick(): void {
  function end() {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointerdown", end, true);
  }
  function onClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    end();
  }
  document.addEventListener("click", onClick, true);
  document.addEventListener("pointerdown", end, true);
}

/** UC-05 steps 2–4 (Figure 8.1): confirm the old value (BR-04), type the new one (BR-05). */
export function EditPopover({ detection, edit, style, onApply, onRevert, onClose }: Props) {
  const t = useMessages();
  const p = t.editor.popover;
  const id = useId();
  const root = useRef<HTMLFormElement | null>(null);
  const oldInput = useRef<HTMLInputElement | null>(null);
  const newInput = useRef<HTMLInputElement | null>(null);
  const close = useRef(onClose);
  const hasReading = Boolean(edit?.oldValue ?? detection.readValue);
  const [oldRaw, setOldRaw] = useState(edit?.oldValue ?? detection.readValue ?? "");
  const [newRaw, setNewRaw] = useState(edit?.newValue ?? "");
  const [oldError, setOldError] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);

  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    // A hand-drawn value has no machine reading: the person confirms the old value first.
    const first = hasReading ? newInput.current : oldInput.current;
    first?.focus();
    first?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on opening
  }, []);

  // Escape closes the popover wherever focus is, also after the person tabbed out of it.
  useEffect(() => {
    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[aria-modal='true']")) return; // a modal dialog owns Escape
      e.preventDefault();
      close.current(true);
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  // A press outside closes the popover; a press on its own marker leaves it open.
  useEffect(() => {
    function onPointer(e: PointerEvent) {
      const target = e.target instanceof Element ? e.target : null;
      if (!target || root.current?.contains(target)) return;
      const own = CSS.escape(detection.id);
      if (target.closest(`[data-detection="${own}"], [data-value-row="${own}"]`)) return;
      close.current(false);
      // The press only closes the popover: the click that follows it on the bare page does not start a read.
      if (!target.closest(INTERACTIVE)) swallowNextClick();
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [detection.id]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const confirmed = normalizeOldValue(oldRaw);
    if (!confirmed.ok) {
      setOldError(p.errors.format);
      setNewError(null);
      oldInput.current?.focus();
      return;
    }
    setOldError(null);
    const next = normalizeNewValue(newRaw, confirmed.value);
    if (!next.ok) {
      setNewError(
        next.error === "decimals" ? fill(p.errors.decimals, { d: decimalsOf(confirmed.value) }) : next.error === "same" ? p.errors.same : p.errors.format,
      );
      newInput.current?.focus();
      return;
    }
    onApply(confirmed.value, next.value);
  }

  const field = "w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-ink";
  return (
    <form
      ref={root}
      role="dialog"
      aria-labelledby={`${id}-title`}
      onSubmit={submit}
      className="absolute z-20 w-80 space-y-3 rounded-lg border border-line bg-surface p-4 text-ink shadow-lg"
      style={style}
    >
      <div className="flex items-center justify-between">
        <h2 id={`${id}-title`} className="font-bold">{p.title}</h2>
        <button type="button" onClick={() => onClose(true)} aria-label={p.close} className="rounded px-2 text-lg leading-none text-ink-2 hover:text-ink">×</button>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-old`} className="block text-sm font-medium">{p.old}</label>
        <input
          ref={oldInput}
          id={`${id}-old`}
          value={oldRaw}
          onChange={(e) => {
            setOldRaw(e.target.value);
            setOldError(null);
          }}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={oldError !== null}
          aria-describedby={oldError ? `${id}-old-hint ${id}-old-error` : `${id}-old-hint`}
          className={field}
        />
        <p id={`${id}-old-hint`} className="text-xs text-ink-2">{p.oldHint}</p>
        {oldError ? <p id={`${id}-old-error`} role="alert" className="text-sm text-danger">{oldError}</p> : null}
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-new`} className="block text-sm font-medium">{p.new}</label>
        <input
          ref={newInput}
          id={`${id}-new`}
          value={newRaw}
          onChange={(e) => {
            setNewRaw(e.target.value);
            setNewError(null);
          }}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={newError !== null}
          aria-describedby={newError ? `${id}-new-error` : undefined}
          className={field}
        />
        {newError ? <p id={`${id}-new-error`} role="alert" className="text-sm text-danger">{newError}</p> : null}
      </div>
      <div className="flex justify-end gap-2">
        {edit ? (
          <button type="button" onClick={onRevert} className="rounded-md border border-line px-3 py-2 text-sm">{p.revert}</button>
        ) : null}
        <button type="submit" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink">{p.apply}</button>
      </div>
    </form>
  );
}
