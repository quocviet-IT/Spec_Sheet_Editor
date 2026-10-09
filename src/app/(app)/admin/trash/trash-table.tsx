"use client";

import { useRef, useState } from "react";
import type { TrashRow } from "@/admin/queries";
import { useMessages } from "@/messages/client";
import { PurgeDialog } from "./purge-dialog";

const TIME = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function localTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : TIME.format(d);
}

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

type Pending = { row: TrashRow; opener: HTMLElement | null };

export function TrashTable({ rows: initialRows }: { rows: TrashRow[] }) {
  const t = useMessages();
  const a = t.admin.trash;
  const [rows, setRows] = useState(initialRows);
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

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-ink-2">{a.empty}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-ink-2">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pr-3 font-medium">{a.columns.sheet}</th>
              <th scope="col" className="py-2 pr-3 font-medium">{a.columns.trashed}</th>
              <th scope="col" className="py-2 pr-3 font-medium">{a.columns.by}</th>
              <th scope="col" className="py-2"><span className="sr-only">{a.deleteForever}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-3">
                    <Thumb url={row.thumbUrl} className="h-12 w-9" />
                    <span className="break-words font-medium">{row.name}</span>
                  </div>
                </td>
                <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{localTime(row.deletedAt)}</td>
                <td className="py-2 pr-3">{row.deletedByName ?? ""}</td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={(e) => { setStatus(""); setPending({ row, opener: e.currentTarget }); }}
                    aria-label={`${a.deleteForever}: ${row.name}`}
                    className="rounded border border-danger px-3 py-1 text-danger hover:bg-danger-soft"
                  >
                    {a.deleteForever}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p ref={statusRef} tabIndex={-1} role="status" className="text-sm text-ink-2 outline-none">{status}</p>
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
