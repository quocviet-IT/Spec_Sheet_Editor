export const CSV_BOM = "\uFEFF";

/** One CSV cell: quoted when needed, quotes doubled, and a leading ' when a spreadsheet would run it as a formula. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(values: readonly (string | number | null)[]): string {
  return values.map(csvCell).join(",");
}

export type AuditCsvRow = {
  occurredAt: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
};

const LOCAL_TIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

/** "YYYY-MM-DD HH:mm:ss" in Ho Chi Minh City; an unparseable value is written as it came. */
function localTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : LOCAL_TIME.format(d);
}

/** UC-16 step 4: UTF-8 with a BOM so Excel shows Vietnamese correctly; CRLF line ends; times in Ho Chi Minh City. */
export function auditCsv(rows: readonly AuditCsvRow[]): string {
  const lines = [csvLine(["occurred_at", "actor_email", "action", "target_type", "target_id", "detail"])];
  for (const r of rows) {
    lines.push(csvLine([localTime(r.occurredAt), r.actorEmail, r.action, r.targetType, r.targetId, JSON.stringify(r.detail ?? {})]));
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
