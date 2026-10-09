"use server";

import { revalidatePath } from "next/cache";
import { fetchSettings } from "@/admin/queries";
import { SETTING_DEFAULTS, SETTING_KEYS, SETTING_RANGES, type SettingKey } from "@/admin/settings-ranges";
import { requireAdmin } from "@/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";

type Stored = Record<SettingKey, number>;

/** Every result carries the settings as stored after the attempt, so the form never shows an unsaved value as saved. */
export type SaveResult = (
  | { ok: true }
  | { error: "out_of_range"; key: SettingKey }
  | { error: "partial"; saved: SettingKey[] }
  | { error: "forbidden" | "unknown" }
) & { stored: Stored };

/**
 * Saves the system settings in the Admin's own session. Every value is checked against its range first,
 * so nothing is saved when one is out of range; then each value that changed is written (and audited).
 * The ranges live in settings-ranges.ts because a "use server" file may export only async functions.
 */
export async function saveSettings(values: Record<SettingKey, number>): Promise<SaveResult> {
  await requireAdmin("/admin/access");
  // Read after the attempt in the Admin's session; if that read fails, fall back to what was known before plus what was written.
  let known: Stored | null = null;
  const written: Partial<Stored> = {};
  const finish = async <R extends object>(result: R): Promise<R & { stored: Stored }> => {
    try {
      return { ...result, stored: await fetchSettings() };
    } catch {
      return { ...result, stored: { ...(known ?? SETTING_DEFAULTS), ...written } };
    }
  };

  for (const key of SETTING_KEYS) {
    const v = values?.[key];
    const [min, max] = SETTING_RANGES[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) return finish({ error: "out_of_range" as const, key });
  }
  try {
    known = await fetchSettings();
    const stored = known;
    const supabase = await createSupabaseServer();
    const saved: SettingKey[] = [];
    for (const key of SETTING_KEYS) {
      if (values[key] === stored[key]) continue;
      const { error } = await supabase.rpc("set_setting", { p_key: key, p_value: values[key] });
      if (error) {
        // Earlier values are already stored: say so, and return what is really stored.
        if (saved.length > 0) {
          revalidatePath("/admin/access");
          return finish({ error: "partial" as const, saved });
        }
        if (/(?<![a-z_])out_of_range(?![a-z_])/.test(error.message)) return finish({ error: "out_of_range" as const, key });
        if (/(?<![a-z_])forbidden(?![a-z_])/.test(error.message)) return finish({ error: "forbidden" as const });
        return finish({ error: "unknown" as const });
      }
      saved.push(key);
      written[key] = values[key];
    }
    revalidatePath("/admin/access");
    return finish({ ok: true as const });
  } catch {
    return finish({ error: "unknown" as const });
  }
}
