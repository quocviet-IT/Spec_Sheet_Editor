import { getMessages } from "@/messages/server";

export default async function SheetsPage() {
  const t = await getMessages();
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t.sheets.title}</h1>
      <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-10 text-center text-ink-2">
        {t.sheets.empty}
      </p>
    </section>
  );
}
