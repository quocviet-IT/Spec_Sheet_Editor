"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { PageInfo } from "@/admin/paging";
import { fill } from "@/messages/format";
import { useMessages } from "@/messages/client";
import { restoreSheet, trashSheet } from "@/sheets/actions";
import { fileLabel, TIME_ZONE } from "@/sheets/format";
import { sheetListHref } from "@/sheets/list-url";
import type { SheetRow, SheetTab, UploadSettings } from "@/sheets/types";
import { Pagination } from "@/ui/pagination";
import { UploadDialog } from "./upload-dialog";

const TAB_KEYS = ["live", "trash"] as const;

type Toast = { text: string; undo?: () => void } | null;

export function SheetList({
  rows, counts, info, tab, q, settings, locale,
}: {
  rows: SheetRow[]; counts: { live: number; trash: number }; info: PageInfo; tab: SheetTab; q: string;
  settings: UploadSettings; locale: "vi" | "en";
}) {
  const t = useMessages();
  const s = t.sheets;
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [query, setQuery] = useState(q);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [holdToast, setHoldToast] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [brokenThumbs, setBrokenThumbs] = useState<ReadonlySet<string>>(new Set());
  const menuRef = useRef<HTMLDivElement | null>(null);
  const lastPushed = useRef(q);

  const when = useMemo(
    () => new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: TIME_ZONE }),
    [locale],
  );

  const hrefFor = (page: number, size: number) => sheetListHref({ tab, q, page, size });

  // 300 ms after typing stops the address takes the search and returns to page 1 (UC-02 step 2)
  useEffect(() => {
    const typed = query.trim();
    if (typed === lastPushed.current) return;
    const timer = setTimeout(() => {
      lastPushed.current = typed;
      startTransition(() => router.replace(sheetListHref({ tab, q: typed, page: 1, size: info.size })));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, tab, info.size, router]);

  // the address changed without typing here (back or forward): the box follows it
  useEffect(() => {
    if (q !== lastPushed.current) {
      lastPushed.current = q;
      setQuery(q);
    }
  }, [q]);

  // an unmounted toast never fires its leave/blur events, so every change resets the pause
  function showToast(next: Toast) {
    setHoldToast(false);
    setToast(next);
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  // the toast stays 10 s; the timer pauses while the pointer or focus is on it
  useEffect(() => {
    if (!toast || holdToast) return;
    const timer = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(timer);
  }, [toast, holdToast]);

  // an open row menu: focus its first item, close on a press outside it
  useEffect(() => {
    if (!menuFor) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPress = (e: PointerEvent) => {
      const target = e.target as Element;
      if (target.closest('[aria-haspopup="menu"]')) return; // the trigger toggles its own menu
      if (!menuRef.current?.contains(target)) setMenuFor(null);
    };
    document.addEventListener("pointerdown", onPress);
    return () => document.removeEventListener("pointerdown", onPress);
  }, [menuFor]);

  function focusPanel() {
    document.getElementById("sheet-panel")?.focus();
  }

  function onMenuKey(e: React.KeyboardEvent, rowId: string) {
    if (e.key === "Escape") {
      e.preventDefault();
      setMenuFor(null);
      document.getElementById(`sheet-menu-btn-${rowId}`)?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[to].focus();
  }

  async function onTrash(row: SheetRow) {
    setMenuFor(null);
    setPendingId(row.id);
    const result = await trashSheet(row.id);
    setPendingId(null);
    if ("error" in result) {
      showToast({ text: s.actionError });
      document.getElementById(`sheet-menu-btn-${row.id}`)?.focus();
      return;
    }
    refresh();
    focusPanel();
    showToast({
      text: fill(s.trashed, { name: row.name }),
      undo: async () => {
        showToast(null);
        const back = await restoreSheet(row.id);
        if ("error" in back) {
          showToast({ text: s.actionError });
          return;
        }
        refresh();
      },
    });
  }

  async function onRestore(row: SheetRow) {
    setPendingId(row.id);
    const result = await restoreSheet(row.id);
    setPendingId(null);
    if ("error" in result) {
      showToast({ text: s.actionError });
      return;
    }
    refresh();
    focusPanel();
    showToast({ text: fill(s.restored, { name: row.name }) });
  }

  const empty =
    rows.length === 0
      ? q ? fill(s.noMatch, { q }) : tab === "trash" ? s.emptyTrash : s.empty
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav aria-label={s.title} className="flex gap-6 border-b border-line">
          {TAB_KEYS.map((key) => (
            <Link
              key={key}
              id={`sheet-tab-${key}`}
              href={sheetListHref({ tab: key, q, page: 1, size: info.size })}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => setMenuFor(null)}
              className={"-mb-px inline-flex min-h-6 items-center border-b-2 px-1 pb-2 text-sm font-medium " + (tab === key ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink")}
            >
              {s.tabs[key]} <span className="ml-1 rounded-full bg-sunk px-2 py-0.5 font-mono text-xs">{counts[key]}</span>
            </Link>
          ))}
        </nav>
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

      <div
        id="sheet-panel"
        aria-busy={refreshing}
        tabIndex={-1}
        className="overflow-hidden rounded-lg border border-line bg-surface outline-none"
      >
        <ul>
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3 first:border-t-0">
              <div className="h-14 w-[72px] flex-none overflow-hidden rounded border border-line bg-paper">
                {row.thumbUrl && !brokenThumbs.has(row.thumbUrl)
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from another origin, not optimisable
                  ? <img src={row.thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setBrokenThumbs((old) => new Set(old).add(row.thumbUrl!))} />
                  : <span className="flex h-full items-center justify-center text-[10px] text-ink-3">{s.noThumb}</span>}
              </div>
              <div className="min-w-0 flex-1 basis-48">
                {tab === "live"
                  ? <Link href={`/sheets/${row.id}`} prefetch={false} className="font-semibold hover:text-accent hover:underline">{row.name}</Link>
                  : <span className="font-semibold">{row.name}</span>}
                <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-ink-2">
                  <span>{fileLabel(row.sourceType, row.pageW, row.pageH)}</span>
                  {row.pageW < settings.lowresWarnPx && <span className="rounded bg-warn-soft px-1.5 py-0.5 font-sans">{s.lowRes}</span>}
                </div>
              </div>
              <div className="w-40 text-sm">
                {tab === "live"
                  ? row.editCount > 0 ? (row.editCount === 1 ? s.editsOne : fill(s.edits, { n: row.editCount })) : <span className="text-ink-2">{s.noEdits}</span>
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
                      id={`sheet-menu-btn-${row.id}`}
                      aria-haspopup="menu"
                      aria-label={fill(s.menu, { name: row.name })}
                      aria-expanded={menuFor === row.id}
                      onClick={() => setMenuFor(menuFor === row.id ? null : row.id)}
                      className="rounded border border-transparent px-2 py-1 text-lg leading-none hover:border-line hover:bg-sunk"
                    >
                      ⋯
                    </button>
                    {menuFor === row.id && (
                      <div
                        ref={menuRef}
                        role="menu"
                        onKeyDown={(e) => onMenuKey(e, row.id)}
                        onBlur={(e) => {
                          const to = e.relatedTarget as Node | null;
                          if (to && !e.currentTarget.contains(to) && to !== document.getElementById(`sheet-menu-btn-${row.id}`)) setMenuFor(null);
                        }}
                        className="absolute right-0 z-10 mt-1 w-48 rounded-md border border-line bg-surface py-1 shadow-lg"
                      >
                        <Link href={`/sheets/${row.id}`} prefetch={false} role="menuitem" className="block px-3 py-2 text-sm hover:bg-sunk">{s.open}</Link>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={pendingId === row.id}
                          onClick={() => void onTrash(row)}
                          className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-sunk disabled:opacity-60"
                        >
                          {s.trash}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={pendingId === row.id}
                    onClick={() => void onRestore(row)}
                    className="rounded border border-line px-3 py-1 text-sm hover:bg-sunk disabled:opacity-60"
                  >
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
            {tab === "live" && !q && (
              <button type="button" onClick={() => setUploadOpen(true)} className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink">
                {s.upload}
              </button>
            )}
          </div>
        )}
        {info.total > 0 && <Pagination info={info} hrefFor={hrefFor} />}
        {tab === "trash" && <p className="border-t border-line bg-sunk px-4 py-3 text-sm text-ink-2">{s.trashNote}</p>}
      </div>

      <div role="status" aria-live="polite" className="fixed inset-x-4 bottom-6 z-20 mx-auto w-fit max-w-[calc(100vw-2rem)]">
        {toast && (
          <div
            onPointerEnter={() => setHoldToast(true)}
            onPointerLeave={() => setHoldToast(false)}
            onFocus={() => setHoldToast(true)}
            onBlur={() => setHoldToast(false)}
            className="flex items-center gap-3 rounded-lg bg-ink px-4 py-3 text-sm text-paper shadow-lg"
          >
            <span>{toast.text}</span>
            {toast.undo && (
              <button type="button" onClick={toast.undo} className="rounded border border-paper/40 px-2 py-1">{s.undo}</button>
            )}
          </div>
        )}
      </div>

      {uploadOpen && <UploadDialog settings={settings} onClose={() => setUploadOpen(false)} />}
    </div>
  );
}
