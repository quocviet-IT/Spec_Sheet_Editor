"use server";

import { revalidatePath } from "next/cache";
import { fetchSettings } from "@/admin/queries";
import { SETTING_KEYS, SETTING_RANGES, type SettingKey } from "@/admin/settings-ranges";
import { requireAdmin } from "@/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Saves the system settings in the Admin's own session. Every value is checked against its range first,
 * so nothing is saved when one is out of range; then each value that changed is written (and audited).
 * The ranges live in settings-ranges.ts because a "use server" file may export only async functions.
 */
export async function saveSettings(
  values: Record<SettingKey, number>,
): Promise<{ ok: true } | { error: "out_of_range"; key: SettingKey } | { error: "partial"; saved: SettingKey[] } | { error: "forbidden" | "unknown" }> {
  await requireAdmin("/admin/access");
  for (const key of SETTING_KEYS) {
    const v = values?.[key];
    const [min, max] = SETTING_RANGES[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) return { error: "out_of_range", key };
  }
  try {
    const stored = await fetchSettings();
    const supabase = await createSupabaseServer();
    const saved: SettingKey[] = [];
    for (const key of SETTING_KEYS) {
      if (values[key] === stored[key]) continue;
      const { error } = await supabase.rpc("set_setting", { p_key: key, p_value: values[key] });
      if (error) {
        // Earlier values are already stored: say so, so the form shows what is really saved.
        if (saved.length > 0) {
          revalidatePath("/admin/access");
          return { error: "partial", saved };
        }
        if (/(?<![a-z_])out_of_range(?![a-z_])/.test(error.message)) return { error: "out_of_range", key };
        if (/(?<![a-z_])forbidden(?![a-z_])/.test(error.message)) return { error: "forbidden" };
        return { error: "unknown" };
      }
      saved.push(key);
    }
    revalidatePath("/admin/access");
    return { ok: true };
  } catch {
    return { error: "unknown" };
  }
}
