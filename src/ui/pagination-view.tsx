"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { PAGE_SIZES, type PageInfo } from "@/admin/paging";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";

export type PaginationLinks = { action: string; hidden: [string, string][]; previous: string; next: string };

const step = "inline-flex size-8 items-center justify-center rounded-md border border-line text-ink hover:bg-sunk";
const stepOff = "inline-flex size-8 items-center justify-center rounded-md border border-line text-ink-3 opacity-50";

/**
 * The rendering half of Pagination (see pagination.tsx). Accessibility: the size select has a label "Rows per page",
 * previous and next carry aria-labels, and the ends are disabled. In link mode previous and next are real links and
 * the select belongs to a GET form, so everything works without JavaScript; with JavaScript, changing the select
 * submits the form.
 */
export function PaginationView({ info, links, onChange }: {
  info: PageInfo;
  links?: PaginationLinks;
  onChange?: (page: number, size: number) => void;
}) {
  const t = useMessages();
  const id = useId();
  const atStart = info.page <= 1;
  const atEnd = info.page >= info.pages;

  const select = (
    <select
      id={`${id}-size`}
      name="size"
      defaultValue={info.size}
      onChange={(e) => {
        if (links) e.currentTarget.form?.requestSubmit();
        else onChange?.(1, Number(e.currentTarget.value));
      }}
      className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
    >
      {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
    </select>
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-ink-2">
      <p>{fill(t.admin.ui.showing, { from: info.from, to: info.to, total: info.total })}</p>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-size`}>{t.admin.ui.rowsPerPage}</label>
          {links ? (
            <form method="get" action={links.action} className="flex items-center gap-2">
              {links.hidden.map(([name, value]) => <input key={`${name}=${value}`} type="hidden" name={name} value={value} />)}
              {select}
              <noscript>
                <button type="submit" className="rounded-md border border-line px-2 py-1 text-sm text-ink">{t.admin.ui.apply}</button>
              </noscript>
            </form>
          ) : select}
        </div>
        <p>{fill(t.admin.ui.pageOf, { page: info.page, pages: info.pages })}</p>
        <div className="flex items-center gap-1">
          {atStart ? (
            <button type="button" disabled aria-label={t.admin.ui.previous} className={stepOff}><ChevronLeft size={16} aria-hidden="true" /></button>
          ) : links ? (
            <Link href={links.previous} aria-label={t.admin.ui.previous} className={step}><ChevronLeft size={16} aria-hidden="true" /></Link>
          ) : (
            <button type="button" aria-label={t.admin.ui.previous} onClick={() => onChange?.(info.page - 1, info.size)} className={step}><ChevronLeft size={16} aria-hidden="true" /></button>
          )}
          {atEnd ? (
            <button type="button" disabled aria-label={t.admin.ui.next} className={stepOff}><ChevronRight size={16} aria-hidden="true" /></button>
          ) : links ? (
            <Link href={links.next} aria-label={t.admin.ui.next} className={step}><ChevronRight size={16} aria-hidden="true" /></Link>
          ) : (
            <button type="button" aria-label={t.admin.ui.next} onClick={() => onChange?.(info.page + 1, info.size)} className={step}><ChevronRight size={16} aria-hidden="true" /></button>
          )}
        </div>
      </div>
    </div>
  );
}
