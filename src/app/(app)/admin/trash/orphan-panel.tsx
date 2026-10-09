"use client";

import { useState } from "react";
import { formatBytes } from "@/admin/orphans";
import { checkOrphans, cleanOrphans } from "@/admin/trash-actions";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import { ConfirmDialog } from "../users/users-table";

type Found = { folders: number; bytes: number; names: string[] };

export function OrphanPanel() {
  const t = useMessages();
  const a = t.admin.trash;
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");
  const [alert, setAlert] = useState<string | null>(null);

  async function check() {
    if (busy) return;
    setBusy(true);
    setFound(null);
    setStatus("");
    setAlert(null);
    let result: Awaited<ReturnType<typeof checkOrphans>>;
    try {
      result = await checkOrphans();
    } catch {
      result = { error: "unknown" };
    }
    setBusy(false);
    if ("error" in result) setAlert(result.error === "forbidden" ? t.admin.users.errors.forbidden : a.cleanFailed);
    else if (result.folders === 0) setStatus(a.none);
    else setFound(result);
  }

  async function clean() {
    if (!found || busy) return;
    setBusy(true);
    setAlert(null);
    let result: Awaited<ReturnType<typeof cleanOrphans>>;
    try {
      result = await cleanOrphans({ names: found.names });
    } catch {
      result = { error: "unknown" };
    }
    setBusy(false);
    setConfirming(false);
    if ("ok" in result) {
      setFound(null);
      setStatus(fill(a.cleaned, { n: result.folders, size: formatBytes(result.bytes) }));
    } else {
      setAlert(result.error === "forbidden" ? t.admin.users.errors.forbidden : a.cleanFailed);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{a.orphans}</h2>
      <p className="text-sm text-ink-2">{a.orphansLead}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void check()} disabled={busy} aria-busy={busy} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50">
          {busy && !confirming ? a.checking : a.check}
        </button>
        {found && (
          <>
            <span className="text-sm tabular-nums">{fill(a.found, { n: found.folders, size: formatBytes(found.bytes) })}</span>
            <button type="button" onClick={() => setConfirming(true)} disabled={busy} className="rounded-md bg-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              {fill(a.clean, { n: found.folders })}
            </button>
          </>
        )}
      </div>
      <p role="status" className="text-sm text-ink-2">{status}</p>
      {alert && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm">{alert}</p>}
      {confirming && found && (
        <ConfirmDialog
          message={fill(a.cleanConfirm, { n: found.folders, size: formatBytes(found.bytes) })}
          confirmLabel={fill(a.clean, { n: found.folders })}
          cancelLabel={a.cancel}
          busy={busy}
          onConfirm={() => void clean()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
