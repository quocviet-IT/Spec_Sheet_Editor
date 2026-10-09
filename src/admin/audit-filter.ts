const TIME_ZONE = "Asia/Ho_Chi_Minh";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const AUDIT_GROUPS = ["all", "auth", "sheet", "user", "access", "settings", "maintenance"] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];
export type AuditFilter = { from: string; to: string; actor: string | null; group: AuditGroup; target: string | null };

/** "YYYY-MM-DD" of `date` in Ho Chi Minh City. */
function localDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The first value of a query parameter if it is a string; anything else (missing, empty array, object) is ignored. */
function first(v: unknown): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x : undefined;
}

function validDay(v: string | undefined): string | null {
  if (!v || !DAY.test(v)) return null;
  return new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v ? v : null;
}

/** UC-16 step 1–2: the filter from the URL, defaulting to the last 7 days and every action. */
export function parseAuditFilter(params: Record<string, string | string[] | undefined>, now: Date): AuditFilter {
  const today = localDay(now);
  let from = validDay(first(params.from)) ?? addDays(today, -6);
  let to = validDay(first(params.to)) ?? today;
  if (from > to) [from, to] = [to, from];
  const g = first(params.group) ?? "";
  const group = (AUDIT_GROUPS as readonly string[]).includes(g) ? (g as AuditGroup) : "all";
  const a = first(params.actor);
  const t = first(params.target);
  const actor = a && UUID.test(a) ? a.toLowerCase() : null;
  const target = t && UUID.test(t) ? t.toLowerCase() : null;
  return { from, to, actor, group, target };
}

/** Whole local days: from 00:00 on `from` to 00:00 the day after `to` (UTC+07:00, no daylight saving), as UTC `Z` strings. */
export function auditRange(filter: AuditFilter): { fromIso: string; toIsoExclusive: string } {
  const utc = (day: string) => new Date(new Date(`${day}T00:00:00Z`).getTime() - 7 * 3_600_000).toISOString();
  return { fromIso: utc(filter.from), toIsoExclusive: utc(addDays(filter.to, 1)) };
}

export function groupPrefix(group: AuditGroup): string | null {
  return group === "all" ? null : `${group}.`;
}

export function filterQuery(filter: AuditFilter): string {
  const q = new URLSearchParams({ from: filter.from, to: filter.to });
  if (filter.actor) q.set("actor", filter.actor);
  if (filter.group !== "all") q.set("group", filter.group);
  if (filter.target) q.set("target", filter.target);
  return q.toString();
}
