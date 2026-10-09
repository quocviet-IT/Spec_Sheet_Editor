/** The four system settings and their allowed ranges (the database enforces the same ranges). */
export type SettingKey = "max_file_mb" | "lowres_warn_px" | "aspect_tolerance_pct" | "signed_url_ttl_min";

export const SETTING_KEYS: SettingKey[] = ["max_file_mb", "lowres_warn_px", "aspect_tolerance_pct", "signed_url_ttl_min"];

export const SETTING_RANGES: Record<SettingKey, readonly [number, number]> = {
  max_file_mb: [1, 50],
  lowres_warn_px: [800, 5000],
  aspect_tolerance_pct: [0.5, 5],
  signed_url_ttl_min: [1, 60],
};

/** What a missing settings row means (the database seeds the same values). */
export const SETTING_DEFAULTS: Record<SettingKey, number> = { max_file_mb: 20, lowres_warn_px: 2000, aspect_tolerance_pct: 2, signed_url_ttl_min: 10 };
