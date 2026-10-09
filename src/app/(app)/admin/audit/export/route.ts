import { parseAuditFilter } from "@/admin/audit-filter";
import { auditCsv } from "@/admin/csv";
import { fetchAuditAll } from "@/admin/queries";
import { requireAdmin } from "@/auth/session";
import { getMessages } from "@/messages/server";

export const dynamic = "force-dynamic";

const TEXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  await requireAdmin("/admin/audit");
  try {
    const params: Record<string, string[]> = {};
    for (const [k, v] of new URL(request.url).searchParams) (params[k] ??= []).push(v);
    const filter = parseAuditFilter(params, new Date());
    const { rows, overCap } = await fetchAuditAll(filter);
    if (overCap) {
      const t = await getMessages();
      return new Response(t.admin.audit.tooMany, { status: 413, headers: TEXT });
    }
    return new Response(auditCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-${filter.from}-${filter.to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("audit export failed:", error);
    const t = await getMessages();
    return new Response(t.admin.users.errors.unknown, { status: 500, headers: TEXT });
  }
}
