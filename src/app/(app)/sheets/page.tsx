import { pageInfo, parsePaging } from "@/admin/paging";
import { requireUser } from "@/auth/session";
import { getLocale, getMessages } from "@/messages/server";
import { parseSheetTab } from "@/sheets/list-url";
import { fetchCounts, fetchSheetPageNumbered, fetchUploadSettings } from "@/sheets/queries";
import { SheetList } from "./sheet-list";

const MAX_QUERY = 200;

export default async function SheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("/sheets");
  const params = await searchParams;
  const tab = parseSheetTab(params.tab);
  const rawQ = Array.isArray(params.q) ? params.q[0] : params.q;
  const q = (rawQ ?? "").trim().slice(0, MAX_QUERY);
  const { page, size } = parsePaging(params);
  const [t, locale, shown, counts, settings] = await Promise.all([
    getMessages(), getLocale(), fetchSheetPageNumbered(tab, q, page, size), fetchCounts(), fetchUploadSettings(),
  ]);
  const info = pageInfo(shown.total, shown.page, size);
  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t.sheets.title}</h1>
        <p className="text-ink-2">{t.sheets.lead}</p>
      </div>
      <SheetList rows={shown.rows} counts={counts} info={info} tab={tab} q={q} settings={settings} locale={locale} />
    </section>
  );
}
