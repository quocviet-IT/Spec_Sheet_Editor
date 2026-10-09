import Link from "next/link";
import { AUDIT_GROUPS, filterQuery, parseAuditFilter } from "@/admin/audit-filter";
import { AUDIT_CSV_MAX, fetchAudit, fetchAuditPeople } from "@/admin/queries";
import { requireAdmin } from "@/auth/session";
import { getMessages } from "@/messages/server";

const field = "w-full rounded-md border border-line bg-surface px-3 py-2";
const TIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function localTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : TIME.format(d);
}

function parseBefore(v: string | string[] | undefined): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s || !/^[1-9]\d{0,15}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/audit");
  const params = await searchParams;
  const t = await getMessages();
  const a = t.admin.audit;
  const filter = parseAuditFilter(params, new Date());
  const before = parseBefore(params.before);
  const [{ rows, next, total }, people] = await Promise.all([fetchAudit(filter, before), fetchAuditPeople()]);
  const query = filterQuery(filter);
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{a.title}</h1>
        <p className="text-ink-2">{a.lead}</p>
      </div>
      <form method="get" className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[repeat(5,1fr)_auto] sm:items-end">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{a.from}</span>
          <input type="date" name="from" defaultValue={filter.from} className={field} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{a.to}</span>
          <input type="date" name="to" defaultValue={filter.to} className={field} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{a.person}</span>
          <select name="actor" defaultValue={filter.actor ?? ""} className={field}>
            <option value="">{a.anyone}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName ? `${p.fullName} (${p.email})` : p.email}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{a.group}</span>
          <select name="group" defaultValue={filter.group} className={field}>
            {AUDIT_GROUPS.map((g) => (
              <option key={g} value={g}>
                {a.groups[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{a.target}</span>
          <input name="target" defaultValue={filter.target ?? ""} autoComplete="off" spellCheck={false} className={field} />
        </label>
        <button type="submit" className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink hover:opacity-90">
          {a.apply}
        </button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-ink-2">{a.count.replace("{n}", total.toLocaleString("en-US"))}</p>
        {total > AUDIT_CSV_MAX ? (
          <p role="note" className="text-ink-2">
            {a.tooMany}
          </p>
        ) : (
          <a href={`/admin/audit/export?${query}`} className="rounded-md border border-line px-3 py-2 font-medium hover:bg-sunk">
            {a.csv}
          </a>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-ink-2">{a.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-sunk text-left text-ink-2">
              <tr>
                <th className="px-3 py-2 font-medium">{a.columns.when}</th>
                <th className="px-3 py-2 font-medium">{a.columns.who}</th>
                <th className="px-3 py-2 font-medium">{a.columns.action}</th>
                <th className="px-3 py-2 font-medium">{a.columns.target}</th>
                <th className="px-3 py-2 font-medium">{a.columns.detail}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-3 py-2">{localTime(r.occurredAt)}</td>
                  <td className="px-3 py-2">{r.actorEmail || a.system}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.targetType && <span className="block">{r.targetType}</span>}
                    {r.targetId && <span className="block break-all font-mono text-ink-2">{r.targetId}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <details>
                      <summary className="cursor-pointer">{a.details}</summary>
                      <pre className="mt-2 max-w-md overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-sunk p-2 text-xs">
                        {JSON.stringify(r.detail ?? {}, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next !== null && (
        <Link href={`/admin/audit?${query}&before=${next}`} className="inline-block rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-sunk">
          {a.more}
        </Link>
      )}
    </section>
  );
}
