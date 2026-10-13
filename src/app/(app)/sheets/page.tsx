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
  const asked = isAdmin ? parseSheetOwner(params.owner) : "all";
  // A person picked by id must be one the Creator select offers; otherwise (no sheets left, a stale link) the list
  // shows All, as the select does. Only this case waits for the owners before reading the page.
  const ownersRead = isAdmin ? fetchSheetOwners() : Promise.resolve([]);
  const owners = asked === "all" || asked === "me" ? null : await ownersRead;
  const owner = owners && !owners.some((o) => o.id === asked) ? "all" : asked;
  const ownerId = owner === "me" ? me.id : owner === "all" ? null : owner;
  const [t, locale, shown, counts, settings, offered] = await Promise.all([
    getMessages(), getLocale(), fetchSheetPageNumbered(tab, q, page, size, ownerId), fetchCounts(ownerId), fetchUploadSettings(), ownersRead,
  ]);
  const info = pageInfo(shown.total, shown.page, size);
  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t.sheets.title}</h1>
        <p className="text-ink-2">{t.sheets.lead}</p>
      </div>
      <SheetList rows={shown.rows} counts={counts} info={info} tab={tab} q={q} owner={owner} owners={offered} isAdmin={isAdmin} settings={settings} locale={locale} />
    </section>
  );
}
