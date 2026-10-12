"use client";

import { FileUp, ImageDown, Ratio, SlidersHorizontal, Timer, type LucideIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { saveSettings, type SaveResult } from "@/admin/settings-actions";
import { SETTING_KEYS, SETTING_RANGES, type SettingKey } from "@/admin/settings-ranges";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";

const ICONS: Record<SettingKey, LucideIcon> = {
  max_file_mb: FileUp,
  lowres_warn_px: ImageDown,
  aspect_tolerance_pct: Ratio,
  signed_url_ttl_min: Timer,
};

const toText = (v: Record<SettingKey, number>) =>
  Object.fromEntries(SETTING_KEYS.map((k) => [k, String(v[k])])) as Record<SettingKey, string>;
const signature = (v: Record<SettingKey, number>) => SETTING_KEYS.map((k) => v[k]).join("|");

export function SettingsForm({ initial }: { initial: Record<SettingKey, number> }) {
  const t = useMessages();
  const a = t.admin.access;
  const id = useId();
  const [values, setValues] = useState<Record<SettingKey, string>>(() => toText(initial));
  // Follow the stored values when the page is revalidated and they differ from what was last seen (the page is also
  // revalidated by adding or removing an entry, which must not wipe edits that are not saved yet).
  const [seen, setSeen] = useState(() => signature(initial));
  if (seen !== signature(initial)) {
    setSeen(signature(initial));
    setValues(toText(initial));
  }
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
    let result: SaveResult | { error: "unknown"; stored?: undefined };
    try {
      result = await saveSettings(numbers);
    } catch {
      result = { error: "unknown" };
    }
    setBusy(false);
    // Show what is stored, so nothing unsaved looks saved after a partial save.
    const stored = result.stored;
    if (stored && ("ok" in result || result.error === "partial")) {
      setValues(toText(stored));
    }
    if ("ok" in result) setSaved(true);
    else if (result.error === "out_of_range") setBadKey(result.key);
    else if (result.error === "partial") setAlert(a.partial);
    else setAlert(result.error === "forbidden" ? t.admin.users.errors.forbidden : a.errors.unknown);
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby={`${id}-title`} className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <h2 id={`${id}-title`} className="flex items-center gap-2 text-base font-semibold">
          <SlidersHorizontal size={20} aria-hidden="true" className="shrink-0 text-accent" />
          {a.settings}
        </h2>
      </header>
      <ul className="divide-y divide-line">
        {SETTING_KEYS.map((key) => {
          const [min, max] = SETTING_RANGES[key];
          const invalid = badKey === key;
          const Icon = ICONS[key];
          const hint = `${id}-${key}-hint`;
          const error = `${id}-${key}-error`;
          const unit = `${id}-${key}-unit`;
          return (
            <li key={key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <Icon size={16} aria-hidden="true" className="shrink-0 text-ink-2" />
              <div className="min-w-[14rem] flex-1">
                <label htmlFor={`${id}-${key}`} className="block text-sm font-medium">{a.fields[key]}</label>
                <p id={hint} className="text-xs text-ink-2">{fill(a.rangeHint, { min, max })}</p>
                {invalid && <p id={error} className="text-sm text-danger">{fill(a.range, { min, max })}</p>}
              </div>
              <div className="flex items-center gap-2">
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
                  aria-describedby={invalid ? `${hint} ${unit} ${error}` : `${hint} ${unit}`}
                  className="w-28 rounded-md border border-line bg-surface px-3 py-2 text-sm tabular-nums"
                />
                <span id={unit} className="w-24 text-sm text-ink-2">{a.units[key]}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
        <button type="submit" disabled={busy} aria-busy={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50">
          {busy ? a.saving : a.save}
        </button>
        <p role="status" className="text-sm text-ink-2">{saved ? a.saved : ""}</p>
      </div>
      {alert && <p role="alert" className="mx-4 mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm">{alert}</p>}
    </form>
  );
}
