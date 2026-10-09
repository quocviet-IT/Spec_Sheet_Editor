export const CSV_BOM = "﻿";

/** One CSV cell: quoted when needed, quotes doubled, and a leading ' when a spreadsheet would run it as a formula. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
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

/** UC-16 step 4: UTF-8 with a BOM so Excel shows Vietnamese correctly; CRLF line ends. */
export function auditCsv(rows: readonly AuditCsvRow[]): string {
  const lines = [csvLine(["occurred_at", "actor_email", "action", "target_type", "target_id", "detail"])];
  for (const r of rows) {
    lines.push(csvLine([r.occurredAt, r.actorEmail, r.action, r.targetType, r.targetId, JSON.stringify(r.detail ?? {})]));
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
