import {
  Activity, CalendarRange, Download, Eraser, FileText, History, ListFilter, LogIn, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Trash2, Upload, User, UserCog, Wrench,
  type LucideIcon,
} from "lucide-react";
import { AUDIT_GROUPS, filterQuery, parseAuditFilter } from "@/admin/audit-filter";
import { auditActionLabel, auditIconKey, type AuditIconKey } from "@/admin/audit-icons";
import { pageInfo, parsePaging } from "@/admin/paging";
import { initials } from "@/admin/row-menu-keys";
import { AUDIT_CSV_MAX, fetchAuditPage, fetchAuditPeople } from "@/admin/queries";
import { requireAdmin } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { EmptyState } from "../ui/empty-state";
import { PageHeader } from "../ui/page-header";
import { Pagination } from "../ui/pagination";
import { RelativeTime } from "../ui/relative-time";

const ICONS: Record<AuditIconKey, LucideIcon> = {
  upload: Upload, save: Save, export: Download, trash: Trash2, restore: RotateCcw, purge: Eraser, signin: LogIn,
  user: UserCog, access: ShieldCheck, settings: SlidersHorizontal, maintenance: Wrench, activity: Activity,
};

const field = "w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink";
const iconInField = "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3";
const TIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function localTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : TIME.format(d);
}

/** The pinned snapshot id from the URL: a positive safe integer, or null. */
function parseUpto(v: string | string[] | undefined): number | null {
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
  const { page, size } = parsePaging(params);
  const [{ rows, total, upto }, people] = await Promise.all([fetchAuditPage(filter, parseUpto(params.upto), page, size), fetchAuditPeople()]);
  const query = filterQuery(filter);
  const nameOf = new Map(people.map((p) => [p.email.toLowerCase(), p.fullName]));
  const info = pageInfo(total, page, size);
  const hrefFor = (p: number, s: number) => `/admin/audit?${query}&upto=${upto}&page=${p}&size=${s}`;
  return (
    <section>
      <PageHeader icon={History} title={a.title} lead={a.lead} />
      <div className="rounded-lg border border-line bg-surface">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <form method="get" className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
            <input type="hidden" name="size" value={size} />
            <label className="space-y-1 text-sm">
              <span className="block font-medium">{a.from}</span>
              <span className="relative block">
                <CalendarRange size={16} aria-hidden="true" className={iconInField} />
                <input type="date" name="from" defaultValue={filter.from} className={field} />
              </span>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block font-medium">{a.to}</span>
              <span className="relative block">
                <CalendarRange size={16} aria-hidden="true" className={iconInField} />
                <input type="date" name="to" defaultValue={filter.to} className={field} />
              </span>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block font-medium">{a.person}</span>
              <span className="relative block">
                <User size={16} aria-hidden="true" className={iconInField} />
                <select name="actor" defaultValue={filter.actor ?? ""} className={field}>
                  <option value="">{a.anyone}</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName ? `${p.fullName} (${p.email})` : p.email}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block font-medium">{a.group}</span>
              <span className="relative block">
                <ListFilter size={16} aria-hidden="true" className={iconInField} />
                <select name="group" defaultValue={filter.group} className={field}>
                  {AUDIT_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {a.groups[g]}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block font-medium">{a.target}</span>
              <span className="relative block">
                <FileText size={16} aria-hidden="true" className={iconInField} />
                <input name="target" defaultValue={filter.target ?? ""} autoComplete="off" spellCheck={false} className={field} />
              </span>
            </label>
            <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:opacity-90">
              {a.apply}
            </button>
          </form>
          {total > AUDIT_CSV_MAX ? (
            <p role="note" className="ml-auto text-sm text-ink-2">
              {a.tooMany}
            </p>
          ) : total === 0 ? (
            <span className="ml-auto inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink-3">
              <Download size={16} aria-hidden="true" />
              {a.csv}
            </span>
          ) : (
            <a href={`/admin/audit/export?${query}`} className="ml-auto inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-sunk">
              <Download size={16} aria-hidden="true" />
              {a.csv}
            </a>
          )}
        </div>
        <p className="border-b border-line px-4 py-2 text-sm text-ink-2">{a.count.replace("{n}", total.toLocaleString("en-US"))}</p>
        {rows.length === 0 ? (
          <EmptyState icon={History} title={a.empty} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-sunk text-left text-ink-2">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">{a.columns.when}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{a.columns.who}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{a.columns.action}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{a.columns.target}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{a.columns.detail}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const Icon = ICONS[auditIconKey(r.action)];
                    const label = auditActionLabel(a.actions, r.action);
                    const name = r.actorEmail ? nameOf.get(r.actorEmail.toLowerCase()) ?? null : null;
                    return (
                      <tr key={r.id} className="border-t border-line align-top">
                        <td className="whitespace-nowrap px-4 py-3">
                          <RelativeTime iso={r.occurredAt} />
                          <span className="block text-xs text-ink-2">{localTime(r.occurredAt)}</span>
                        </td>
                        <td className="px-4 py-3">
                          {r.actorEmail ? (
                            <span className="flex items-center gap-2">
                              <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-sunk text-xs font-semibold text-ink-2">
                                {initials(name, r.actorEmail ?? "")}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{name ?? r.actorEmail}</span>
                                {name && <span className="block truncate text-xs text-ink-2">{r.actorEmail}</span>}
                              </span>
                            </span>
                          ) : (
                            <span className="text-ink-2">{a.system}</span>
                          )}
                        </td>
                        <td data-action={r.action} className="px-4 py-3">
                          <span className="flex items-center gap-2">
                            <Icon size={16} aria-hidden="true" className="shrink-0 text-ink-2" />
                            <span className="flex flex-col">
                              {label ? (
                                <>
                                  <span>{label}</span>
                                  <span className="font-mono text-xs text-ink-2">{r.action}</span>
                                </>
                              ) : (
                                <span className="font-mono text-xs">{r.action}</span>
                              )}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {r.targetType && <span className="block">{r.targetType}</span>}
                          {r.targetId && <span className="block break-all font-mono text-ink-2">{r.targetId}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <details>
                            <summary className="cursor-pointer">
                              {a.details}
                              <span className="sr-only">{` ${label ?? r.action} ${localTime(r.occurredAt)}`}</span>
                            </summary>
                            <pre tabIndex={0} className="mt-2 max-w-md overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-sunk p-2 text-xs">
                              {JSON.stringify(r.detail ?? {}, null, 2)}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination info={info} hrefFor={hrefFor} />
          </>
        )}
      </div>
    </section>
  );
}
