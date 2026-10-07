/** Interface language. Pure: no cookies, no React, usable on server, client and in tests. */
export const LOCALES = ["vi", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "vi";

/** Cookie holding a staff member's choice on their own machine. */
export const LOCALE_COOKIE = "locale";

/** One year: switching language is a one-off choice, not per session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Untrusted input (cookie, form field) to a locale. Never throws. */
export function parseLocale(raw: unknown): Locale {
  return LOCALES.includes(raw as Locale) ? (raw as Locale) : DEFAULT_LOCALE;
}

export const LOCALE_LABEL: Record<Locale, string> = { vi: "Tiếng Việt", en: "English" };
export const LOCALE_SHORT: Record<Locale, string> = { vi: "VI", en: "EN" };
