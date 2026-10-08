import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { fileLabel } from "@/sheets/format";
import { fetchSheet } from "@/sheets/queries";
import { SheetPreview } from "./sheet-preview";

export default async function SheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser(`/sheets/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const sheet = await fetchSheet(id);
  if (!sheet) notFound();
  const t = await getMessages();
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/sheets" className="text-sm text-ink-2 hover:text-ink">← {t.sheet.back}</Link>
        <h1 className="text-xl font-bold">{sheet.name}</h1>
        <span className="font-mono text-xs text-ink-2">{fileLabel(sheet.sourceType, sheet.pageW, sheet.pageH)}</span>
      </div>
      {sheet.deleted ? (
        <p className="rounded-md border border-line bg-warn-soft px-3 py-2 text-sm">
          {t.sheet.inTrash} <Link href="/sheets" className="underline">{t.sheet.toTrash}</Link>
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-2">{t.sheet.viewOnly}</p>
          {sheet.sourceUrl ? <SheetPreview sourceUrl={sheet.sourceUrl} sourceType={sheet.sourceType} name={sheet.name} /> : <p role="alert">{t.sheet.loadError}</p>}
        </>
      )}
    </section>
  );
}
