const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * "now", "5 minutes ago", "2 days ago" (Intl's words in either language), and the date (dd/mm/yyyy, Vietnam time) from 30 days on.
 * Pure: `now` is passed in, so the result is the same on the server and in tests.
 */
export function relativeTime(iso: string, now: Date, locale: "vi" | "en"): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const ms = Math.max(0, now.getTime() - then.getTime());
  const tag = locale === "vi" ? "vi-VN" : "en-GB";
  if (ms < 60_000) return new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(0, "second");
  if (ms >= 30 * DAY_MS) return DATE.format(then);
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "always" });
  if (ms < 60 * 60_000) return rtf.format(-Math.floor(ms / 60_000), "minute");
  if (ms < DAY_MS) return rtf.format(-Math.floor(ms / (60 * 60_000)), "hour");
  return rtf.format(-Math.floor(ms / DAY_MS), "day");
}
