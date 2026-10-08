import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { fetchEditorSheet } from "@/sheets/queries";
import { Editor } from "./editor";

export default async function SheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser(`/sheets/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const sheet = await fetchEditorSheet(id);
  if (!sheet) notFound();
  const t = await getMessages();
  if (sheet.deleted || sheet.broken || !sheet.sourceUrl) {
    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/sheets" className="text-sm text-ink-2 hover:text-ink">← {t.sheet.back}</Link>
          <h1 className="text-xl font-bold">{sheet.name}</h1>
        </div>
        {sheet.deleted ? (
          <p className="rounded-md border border-line bg-warn-soft px-3 py-2 text-sm">
            {t.sheet.inTrash} <Link href="/sheets" className="underline">{t.sheet.toTrash}</Link>
          </p>
        ) : (
          <p role="alert" className="rounded-md border border-line bg-danger-soft px-3 py-2 text-sm">
            {sheet.broken ? t.editor.dataBroken : t.sheet.loadError}
          </p>
        )}
      </section>
    );
  }
  return (
    <div data-wide>
      <Editor sheet={sheet} />
    </div>
  );
}
