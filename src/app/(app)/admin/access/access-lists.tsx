"use client";

import { useId, useState, type FormEvent } from "react";
import { addAllowed, removeAllowed } from "@/admin/access-actions";
import type { AccessEntry } from "@/admin/queries";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import { ConfirmDialog } from "../users/users-table";

type Kind = "domain" | "email";
type Pending = { kind: Kind; entry: AccessEntry; opener: HTMLElement | null };

function List({ kind, title, entries, onRemove }: {
  kind: Kind;
  title: string;
  entries: AccessEntry[];
  onRemove: (kind: Kind, entry: AccessEntry, opener: HTMLElement) => void;
}) {
  const t = useMessages();
  const a = t.admin.access;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-2">{a.empty}</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {entries.map((entry) => (
            <li key={entry.value} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <div className="break-all font-mono text-sm">{entry.value}</div>
                {entry.note && <div className="text-xs text-ink-2">{entry.note}</div>}
              </div>
              <div className="flex items-center gap-3">
                <span className="whitespace-nowrap text-sm tabular-nums text-ink-2">{fill(a.accounts, { n: entry.accounts })}</span>
                <button
                  type="button"
                  onClick={(e) => onRemove(kind, entry, e.currentTarget)}
                  aria-label={`${a.remove}: ${entry.value}`}
                  className="rounded border border-line px-3 py-1 text-sm hover:bg-sunk"
                >
                  {a.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AccessLists({ domains, emails }: { domains: AccessEntry[]; emails: AccessEntry[] }) {
  const t = useMessages();
  const a = t.admin.access;
  const id = useId();
  const [kind, setKind] = useState<Kind>("domain");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [alert, setAlert] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (adding) return;
    setAdding(true);
    setFieldError(null);
    setStatus("");
    setAlert(null);
    let result: Awaited<ReturnType<typeof addAllowed>>;
    try {
      result = await addAllowed({ kind, value, note });
    } catch {
      result = { error: "unknown" };
    }
    setAdding(false);
    if ("ok" in result) {
      setValue("");
      setNote("");
      setStatus(fill(a.added, { value: result.value }));
    } else if (result.error === "invalid") {
      setFieldError(kind === "domain" ? a.errors.invalidDomain : a.errors.invalidEmail);
    } else if (result.error === "duplicate") {
      setFieldError(a.errors.duplicate);
    } else {
      setAlert(a.errors.unknown);
    }
  }

  function close() {
    const opener = pending?.opener;
    setPending(null);
    if (opener) queueMicrotask(() => { if (opener.isConnected) opener.focus(); });
  }

  async function confirmRemove() {
    if (!pending || busy) return;
    const { kind: k, entry } = pending;
    setBusy(true);
    setStatus("");
    setAlert(null);
    let result: Awaited<ReturnType<typeof removeAllowed>>;
    try {
      result = await removeAllowed({ kind: k, value: entry.value });
    } catch {
      result = { error: "unknown" };
    }
    setBusy(false);
    if ("ok" in result) setStatus(fill(a.removed, { value: entry.value }));
    else setAlert(result.error === "self_lockout" ? a.errors.selfLockout : result.error === "forbidden" ? t.admin.users.errors.forbidden : a.errors.unknown);
    close();
  }

  const errorId = `${id}-error`;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <List kind="domain" title={a.domains} entries={domains} onRemove={(k, entry, opener) => { setStatus(""); setAlert(null); setPending({ kind: k, entry, opener }); }} />
        <List kind="email" title={a.emails} entries={emails} onRemove={(k, entry, opener) => { setStatus(""); setAlert(null); setPending({ kind: k, entry, opener }); }} />
      </div>
      <form onSubmit={add} noValidate className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-surface p-4">
        <div className="space-y-1">
          <label htmlFor={`${id}-kind`} className="block text-sm font-medium">{a.kind}</label>
          <select
            id={`${id}-kind`}
            value={kind}
            onChange={(e) => { setKind(e.target.value as Kind); setFieldError(null); }}
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
          >
            <option value="domain">{a.kinds.domain}</option>
            <option value="email">{a.kinds.email}</option>
          </select>
        </div>
        <div className="min-w-[14rem] flex-1 space-y-1">
          <label htmlFor={`${id}-value`} className="block text-sm font-medium">{a.value}</label>
          <input
            id={`${id}-value`}
            value={value}
            onChange={(e) => { setValue(e.target.value); setFieldError(null); }}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? errorId : undefined}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm"
          />
          {fieldError && <p id={errorId} className="text-sm text-danger">{fieldError}</p>}
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1">
          <label htmlFor={`${id}-note`} className="block text-sm font-medium">{a.note}</label>
          <input
            id={`${id}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
          />
        </div>
        <button type="submit" disabled={adding} aria-busy={adding} className="mt-6 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50">
          {a.add}
        </button>
      </form>
      <p role="status" className="text-sm text-ink-2">{status}</p>
      {alert && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm">{alert}</p>}
      {pending && (
        <ConfirmDialog
          message={fill(a.removeConfirm, { n: pending.entry.loseAccess })}
          confirmLabel={a.remove}
          cancelLabel={t.common.cancel}
          busy={busy}
          onConfirm={confirmRemove}
          onCancel={close}
        />
      )}
    </div>
  );
}
