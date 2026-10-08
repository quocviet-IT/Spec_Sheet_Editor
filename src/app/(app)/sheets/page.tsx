import { requireUser } from "@/auth/session";
import { getLocale, getMessages } from "@/messages/server";
import { fetchCounts, fetchSheetPage, fetchUploadSettings } from "@/sheets/queries";
import { SheetList } from "./sheet-list";

export default async function SheetsPage() {
  await requireUser("/sheets");
  const [t, locale, initial, counts, settings] = await Promise.all([
    getMessages(), getLocale(), fetchSheetPage("live", "", null), fetchCounts(), fetchUploadSettings(),
  ]);
  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t.sheets.title}</h1>
        <p className="text-ink-2">{t.sheets.lead}</p>
      </div>
      <SheetList initial={initial} counts={counts} settings={settings} locale={locale} />
    </section>
  );
}
