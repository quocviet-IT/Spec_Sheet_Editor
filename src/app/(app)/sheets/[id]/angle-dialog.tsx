"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useMessages } from "@/messages/client";

type Choice = "horizontal" | "up" | "down" | "free";
const FIXED: Record<Exclude<Choice, "free">, number> = { horizontal: 0, up: -90, down: 90 };

/** UC-07 step 2: the direction of the value inside the drawn box. */
export function AngleDialog({ style, onChoose, onCancel }: { style: CSSProperties; onChoose: (angle: number) => void; onCancel: () => void }) {
  const t = useMessages();
  const a = t.editor.angle;
  const id = useId();
  const first = useRef<HTMLInputElement | null>(null);
  const [choice, setChoice] = useState<Choice>("horizontal");
  const [degrees, setDegrees] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (choice !== "free") {
      onChoose(FIXED[choice]);
      return;
    }
    const n = Number(degrees.trim().replace(",", "."));
    if (degrees.trim() === "" || !Number.isFinite(n) || n < -179 || n > 180) {
      setError(a.invalid);
      return;
    }
    onChoose(Math.round(n * 100) / 100);
  }

  const options: { key: Choice; label: string }[] = [
    { key: "horizontal", label: a.horizontal },
    { key: "up", label: a.up },
    { key: "down", label: a.down },
    { key: "free", label: a.free },
  ];
  return (
    <form
      role="dialog"
      aria-labelledby={`${id}-title`}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      className="absolute z-30 w-72 space-y-3 rounded-lg border border-line bg-surface p-4 text-ink shadow-lg"
      style={style}
    >
      <h2 id={`${id}-title`} className="font-bold">{a.title}</h2>
      <fieldset className="space-y-1">
        <legend className="sr-only">{a.title}</legend>
        {options.map((o, i) => (
          <label key={o.key} className="flex items-center gap-2 text-sm">
            <input ref={i === 0 ? first : undefined} type="radio" name={`${id}-angle`} checked={choice === o.key} onChange={() => { setChoice(o.key); setError(null); }} />
            {o.label}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={`${id}-deg`} className="block text-sm font-medium">{a.degrees}</label>
        <input
          id={`${id}-deg`}
          inputMode="decimal"
          autoComplete="off"
          disabled={choice !== "free"}
          value={degrees}
          onChange={(e) => { setDegrees(e.target.value); setError(null); }}
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-err` : undefined}
          className="w-28 rounded-md border border-line bg-surface px-3 py-1.5 font-mono disabled:opacity-50"
        />
        {error ? <p id={`${id}-err`} role="alert" className="text-sm text-danger">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-line px-3 py-2 text-sm">{a.cancel}</button>
        <button type="submit" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink">{a.continue}</button>
      </div>
    </form>
  );
}
