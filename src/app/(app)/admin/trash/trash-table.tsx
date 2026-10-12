"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { TrashRow } from "@/admin/queries";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import { restoreSheet } from "@/sheets/actions";
import { EmptyState } from "../ui/empty-state";
import { RelativeTime } from "../ui/relative-time";
import { RowMenu } from "../ui/row-menu";
import { PurgeDialog } from "./purge-dialog";

export function Thumb({ url, className }: { url: string | null; className: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={`${className} shrink-0 overflow-hidden rounded border border-line bg-sunk`}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not a static asset
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setBroken(true)} />
      ) : null}
    </div>
  );
}

function initials(source: string): string {
  const words = source.trim().split(/[\s._@-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0] ?? "?"];
  return letters.map((w) => Array.from(w)[0] ?? "").join("").toUpperCase();
}

type Pending = { row: TrashRow; opener: HTMLElement | null };

export function TrashTable({ rows: initialRows }: { rows: TrashRow[] }) {
  const t = useMessages();
  const a = t.admin.trash;
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  // Follow the server's rows after a purge or restore revalidates the page; the instant local removal still shows
  // until the fresh rows arrive.
  const [seenRows, setSeenRows] = useState(initialRows);
  if (seenRows !== initialRows) {
    setSeenRows(initialRows);
    setRows(initialRows);
  }
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState("");
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const done = useRef(false);

  /** Back to the opener on cancel; after a purge the opener's row is gone, so the status message that announces it takes focus. */
  function close() {
    const opener = pending?.opener;
    const purged = done.current;
    done.current = false;
    setPending(null);
    queueMicrotask(() => {
      if (purged) statusRef.current?.focus();
      else if (opener?.isConnected) opener.focus();
    });
  }

  async function restore(row: TrashRow) {
    setStatus("");
    let result: Awaited<ReturnType<typeof restoreSheet>>;
    try {
      result = await restoreSheet(row.id);
    } catch {
      result = { error: "unknown" };
    }
    if ("error" in result) {
      setStatus(t.sheets.actionError);
    } else {
      setRows((old) => old.filter((r) => r.id !== row.id));
      setStatus(fill(t.sheets.restored, { name: row.name }));
      router.refresh(); // re-reads this page: the total, the page count and the next row
    }
    queueMicrotask(() => statusRef.current?.focus()); // the row that held the menu button is gone
  }

  return (
    <div>
      {rows.length === 0 ? (
        <EmptyState icon={Trash2} title={a.empty} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-sunk text-left text-ink-2">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium"><span className="sr-only">{a.columns.thumbnail}</span></th>
                <th scope="col" className="px-4 py-2 font-medium">{a.columns.sheet}</th>
                <th scope="col" className="px-4 py-2 font-medium">{a.columns.deletedBy}</th>
                <th scope="col" className="px-4 py-2 font-medium">{a.columns.deleted}</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">{a.columns.actions}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line first:border-t-0">
                  <td className="w-px px-4 py-2"><Thumb url={row.thumbUrl} className="h-12 w-9" /></td>
                  <td className="px-4 py-2"><span className="break-words font-medium">{row.name}</span></td>
                  <td className="px-4 py-2">
                    {row.deletedByName ? (
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-sunk text-xs font-semibold text-ink-2">
                          {initials(row.deletedByName)}
                        </span>
                        <span className="min-w-0 truncate">{row.deletedByName}</span>
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2"><RelativeTime iso={row.deletedAt} /></td>
                  <td className="px-4 py-2 text-right">
                    <RowMenu
                      label={fill(t.sheets.menu, { name: row.name })}
                      items={[
                        { key: "restore", label: t.sheets.restore, icon: RotateCcw, onSelect: () => void restore(row) },
                        {
                          key: "purge", label: a.deleteForever, icon: Trash2, tone: "danger", separatorBefore: true,
                          onSelect: (opener) => { setStatus(""); setPending({ row, opener }); },
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p ref={statusRef} tabIndex={-1} role="status" className="px-4 py-2 text-sm text-ink-2 outline-none empty:hidden">{status}</p>
      {pending && (
        <PurgeDialog
          row={pending.row}
          onClose={close}
          onDone={(notice) => {
            setRows((old) => old.filter((r) => r.id !== pending.row.id));
            setStatus(notice);
            done.current = true;
          }}
        />
      )}
    </div>
  );
}
