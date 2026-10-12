import { pageInfo, parsePaging } from "@/admin/paging";
import { requireUser } from "@/auth/session";
import { getLocale, getMessages } from "@/messages/server";
import { parseSheetOwner, parseSheetQuery, parseSheetTab } from "@/sheets/list-url";
import { fetchCounts, fetchSheetOwners, fetchSheetPageNumbered, fetchUploadSettings } from "@/sheets/queries";
import { SheetList } from "./sheet-list";

export default async function SheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser("/sheets");
  const isAdmin = me.role === "admin";
  const params = await searchParams;
  const tab = parseSheetTab(params.tab);
  const q = parseSheetQuery(params.q);
  const { page, size } = parsePaging(params);
  const owner = isAdmin ? parseSheetOwner(params.owner) : "all";
  const ownerId = owner === "me" ? me.id : owner === "all" ? null : owner;
  const [t, locale, shown, counts, settings, owners] = await Promise.all([
    getMessages(), getLocale(), fetchSheetPageNumbered(tab, q, page, size, ownerId), fetchCounts(ownerId), fetchUploadSettings(),
    isAdmin ? fetchSheetOwners() : Promise.resolve([]),
  ]);
  const info = pageInfo(shown.total, shown.page, size);
  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t.sheets.title}</h1>
        <p className="text-ink-2">{t.sheets.lead}</p>
      </div>
      <SheetList rows={shown.rows} counts={counts} info={info} tab={tab} q={q} owner={owner} owners={owners} isAdmin={isAdmin} settings={settings} locale={locale} />
    </section>
  );
}
