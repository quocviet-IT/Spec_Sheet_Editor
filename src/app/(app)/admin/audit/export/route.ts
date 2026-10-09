import { parseAuditFilter } from "@/admin/audit-filter";
import { auditCsv } from "@/admin/csv";
import { AUDIT_CSV_MAX, countAudit, fetchAuditAll } from "@/admin/queries";
import { requireAdmin } from "@/auth/session";
import { getMessages } from "@/messages/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  await requireAdmin("/admin/audit");
  const params: Record<string, string[]> = {};
  for (const [k, v] of new URL(request.url).searchParams) (params[k] ??= []).push(v);
  const filter = parseAuditFilter(params, new Date());
  if ((await countAudit(filter)) > AUDIT_CSV_MAX) {
    const t = await getMessages();
    return new Response(t.admin.audit.tooMany, { status: 413, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const csv = auditCsv(await fetchAuditAll(filter));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-${filter.from}-${filter.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
