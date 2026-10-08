"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fill } from "@/messages/format";
import { useMessages } from "@/messages/client";
import { loadSheets, restoreSheet, trashSheet } from "@/sheets/actions";
import { fileLabel } from "@/sheets/format";
import type { Cursor, SheetPage, SheetRow, SheetTab, UploadSettings } from "@/sheets/types";
import { UploadDialog } from "./upload-dialog";

type Toast = { text: string; undo?: () => void } | null;

export function SheetList({
  initial, counts: initialCounts, settings, locale,
}: { initial: SheetPage; counts: { live: number; trash: number }; settings: UploadSettings; locale: "vi" | "en" }) {
  const t = useMessages();
  const s = t.sheets;
  const [tab, setTab] = useState<SheetTab>("live");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [rows, setRows] = useState<SheetRow[]>(initial.rows);
  const [next, setNext] = useState<Cursor | null>(initial.next);
  const [counts, setCounts] = useState(initialCounts);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const first = useRef(true);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const when = useMemo(
    () => new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }),
    [locale],
  );

  // 300 ms after typing stops (UC-02 step 2)
  useEffect(() => {
    const timer = setTimeout(() => setApplied(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchPage = useCallback(async (after: Cursor | null) => {
    setLoading(true);
    setFailed(false);
    const result = await loadSheets({ tab, query: applied, after });
    setLoading(false);
    if ("error" in result) {
      setFailed(true);
      return;
    }
    setRows((old) => (after ? [...old, ...result.rows] : result.rows));
    setNext(result.next);
  }, [tab, applied]);

  // a new tab or search starts from the first page; the server already rendered the first live page
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void fetchPage(null);
  }, [fetchPage]);

  // load the next 50 when the end of the list scrolls into view (UC-02 step 3)
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next || loading || failed) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void fetchPage(next);
    }, { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [next, loading, failed, fetchPage]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function onTrash(row: SheetRow) {
    setMenuFor(null);
    const result = await trashSheet(row.id);
    if ("error" in result) {
      setToast({ text: s.actionError });
      return;
    }
    setRows((old) => old.filter((r) => r.id !== row.id));
    setCounts((c) => ({ live: c.live - 1, trash: c.trash + 1 }));
    setToast({
      text: fill(s.trashed, { name: row.name }),
      undo: async () => {
        setToast(null);
        const back = await restoreSheet(row.id);
        if ("error" in back) {
          setToast({ text: s.actionError });
          return;
        }
        setCounts((c) => ({ live: c.live + 1, trash: c.trash - 1 }));
        await fetchPage(null);
      },
    });
  }

  async function onRestore(row: SheetRow) {
    const result = await restoreSheet(row.id);
    if ("error" in result) {
      setToast({ text: s.actionError });
      return;
    }
    setRows((old) => old.filter((r) => r.id !== row.id));
    setCounts((c) => ({ live: c.live + 1, trash: c.trash - 1 }));
    setToast({ text: fill(s.restored, { name: row.name }) });
  }

  const empty =
    rows.length === 0 && !loading && !failed
      ? applied ? fill(s.noMatch, { q: applied }) : tab === "trash" ? s.emptyTrash : s.empty
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" aria-label={s.title} className="flex gap-6 border-b border-line">
          {(["live", "trash"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => { setTab(key); setMenuFor(null); }}
              className={"-mb-px border-b-2 px-1 pb-2 text-sm font-medium " + (tab === key ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink")}
            >
              {s.tabs[key]} <span className="ml-1 rounded-full bg-sunk px-2 py-0.5 font-mono text-xs">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          <label className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <span className="sr-only">{s.search}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={s.search}
              className="w-full rounded-md border border-line bg-surface px-3 py-2"
            />
          </label>
          <button type="button" onClick={() => setUploadOpen(true)} className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink hover:opacity-90">
            {s.upload}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <ul>
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3 first:border-t-0">
              <div className="h-14 w-[72px] flex-none overflow-hidden rounded border border-line bg-paper">
                {row.thumbUrl
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from another origin, not optimisable
                  ? <img src={row.thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  : <span className="flex h-full items-center justify-center text-[10px] text-ink-3">{s.noThumb}</span>}
              </div>
              <div className="min-w-0 flex-1 basis-48">
                {tab === "live"
                  ? <Link href={`/sheets/${row.id}`} className="font-semibold hover:text-accent hover:underline">{row.name}</Link>
                  : <span className="font-semibold">{row.name}</span>}
                <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-2">
                  <span>{fileLabel(row.sourceType, row.pageW, row.pageH)}</span>
                  {row.pageW < settings.lowresWarnPx && <span className="rounded bg-warn-soft px-1.5 py-0.5 font-sans">{s.lowRes}</span>}
                </div>
              </div>
              <div className="w-40 text-sm">
                {tab === "live"
                  ? row.editCount > 0 ? fill(s.edits, { n: row.editCount }) : <span className="text-ink-2">{s.noEdits}</span>
                  : <span className="text-ink-2">{row.deletedByName}</span>}
              </div>
              <div className="w-48 text-sm">
                <div>{tab === "live" ? row.updatedByName : s.columns.trashed}</div>
                <div className="font-mono text-xs text-ink-2">{when.format(new Date(tab === "live" ? row.updatedAt : (row.deletedAt as string)))}</div>
              </div>
              <div className="relative ml-auto">
                {tab === "live" ? (
                  <>
                    <button
                      type="button"
                      aria-label={fill(s.menu, { name: row.name })}
                      aria-expanded={menuFor === row.id}
                      onClick={() => setMenuFor(menuFor === row.id ? null : row.id)}
                      className="rounded border border-transparent px-2 py-1 text-lg leading-none hover:border-line hover:bg-sunk"
                    >
                      ⋯
                    </button>
                    {menuFor === row.id && (
                      <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border border-line bg-surface py-1 shadow-lg">
                        <Link href={`/sheets/${row.id}`} className="block px-3 py-2 text-sm hover:bg-sunk">{s.open}</Link>
                        <button type="button" onClick={() => void onTrash(row)} className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-sunk">
                          {s.trash}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <button type="button" onClick={() => void onRestore(row)} className="rounded border border-line px-3 py-1 text-sm hover:bg-sunk">
                    {s.restore}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {empty && (
          <div className="space-y-3 px-4 py-10 text-center text-ink-2">
            <p>{empty}</p>
            {tab === "live" && !applied && (
              <button type="button" onClick={() => setUploadOpen(true)} className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink">
                {s.upload}
              </button>
            )}
          </div>
        )}
        {failed && (
          <div role="alert" className="flex flex-wrap items-center justify-center gap-3 border-t border-line px-4 py-4 text-sm">
            <span>{s.loadError}</span>
            <button type="button" onClick={() => void fetchPage(rows.length > 0 ? next : null)} className="rounded border border-line px-3 py-1 hover:bg-sunk">
              {s.retry}
            </button>
          </div>
        )}
        {next && !failed && (
          <div ref={sentinel} className="border-t border-line px-4 py-3 text-center">
            <button type="button" disabled={loading} onClick={() => void fetchPage(next)} className="rounded border border-line px-3 py-1 text-sm hover:bg-sunk disabled:opacity-60">
              {loading ? s.loading : s.loadMore}
            </button>
          </div>
        )}
        {tab === "trash" && <p className="border-t border-line bg-sunk px-4 py-3 text-sm text-ink-2">{s.trashNote}</p>}
      </div>

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-ink px-4 py-3 text-sm text-paper shadow-lg">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" onClick={toast.undo} className="rounded border border-paper/40 px-2 py-1">{s.undo}</button>
          )}
        </div>
      )}

      {uploadOpen && <UploadDialog settings={settings} onClose={() => setUploadOpen(false)} />}
    </div>
  );
}
