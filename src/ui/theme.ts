/** Colour theme. Pure: no cookies, no React, usable on server, client and in tests. */
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Cookie holding a person's choice on their own machine. */
export const THEME_COOKIE = "theme";

/** One year: choosing a theme is a one-off choice, not per session. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Untrusted input (cookie, form field) to a theme. Never throws; anything unknown follows the system. */
export function parseTheme(raw: unknown): Theme {
  return THEMES.includes(raw as Theme) ? (raw as Theme) : "system";
}
