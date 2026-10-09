"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { saveSettings } from "@/admin/settings-actions";
import { SETTING_KEYS, SETTING_RANGES, type SettingKey } from "@/admin/settings-ranges";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";

export function SettingsForm({ initial }: { initial: Record<SettingKey, number> }) {
  const t = useMessages();
  const a = t.admin.access;
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState<Record<SettingKey, string>>(
    () => Object.fromEntries(SETTING_KEYS.map((k) => [k, String(initial[k])])) as Record<SettingKey, string>,
  );
  const [badKey, setBadKey] = useState<SettingKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setSaved(false);
    setAlert(null);
    setBadKey(null);
    const numbers = {} as Record<SettingKey, number>;
    for (const key of SETTING_KEYS) {
      const [min, max] = SETTING_RANGES[key];
      const n = values[key].trim() === "" ? NaN : Number(values[key]);
      if (!Number.isFinite(n) || n < min || n > max) {
        setBadKey(key);
        return;
      }
      numbers[key] = n;
    }
    setBusy(true);
    let result: Awaited<ReturnType<typeof saveSettings>>;
    try {
      result = await saveSettings(numbers);
    } catch {
      result = { error: "unknown" };
    }
    setBusy(false);
    if ("ok" in result) setSaved(true);
    else if (result.error === "out_of_range") setBadKey(result.key);
    else if (result.error === "partial") {
      setAlert(a.partial);
      router.refresh(); // reload the stored values
    } else setAlert(result.error === "forbidden" ? t.admin.users.errors.forbidden : a.errors.unknown);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <h2 className="text-lg font-semibold">{a.settings}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {SETTING_KEYS.map((key) => {
          const [min, max] = SETTING_RANGES[key];
          const invalid = badKey === key;
          return (
            <div key={key} className="space-y-1">
              <label htmlFor={`${id}-${key}`} className="block text-sm font-medium">{a.fields[key]}</label>
              <input
                id={`${id}-${key}`}
                type="number"
                inputMode="decimal"
                min={min}
                max={max}
                step={key === "aspect_tolerance_pct" ? 0.5 : 1}
                value={values[key]}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [key]: e.target.value }));
                  setSaved(false);
                  if (invalid) setBadKey(null);
                }}
                aria-invalid={invalid ? true : undefined}
                aria-describedby={invalid ? `${id}-${key}-error` : undefined}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm tabular-nums"
              />
              {invalid && <p id={`${id}-${key}-error`} className="text-sm text-danger">{fill(a.range, { min, max })}</p>}
            </div>
          );
        })}
      </div>
      <button type="submit" disabled={busy} aria-busy={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50">
        {busy ? a.saving : a.save}
      </button>
      <p role="status" className="text-sm text-ink-2">{saved ? a.saved : ""}</p>
      {alert && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm">{alert}</p>}
    </form>
  );
}
