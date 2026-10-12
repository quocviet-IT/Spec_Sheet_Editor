"use client";

import { Globe, Mail, Plus, Trash2, type LucideIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { addAllowed, removeAllowed } from "@/admin/access-actions";
import type { AccessEntry } from "@/admin/queries";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import { Badge } from "../ui/badge";
import { Dialog } from "../ui/dialog";
import { EmptyState } from "../ui/empty-state";
import { RelativeTime } from "../ui/relative-time";
import { RowMenu } from "../ui/row-menu";
import { ConfirmDialog } from "../users/users-table";

type Kind = "domain" | "email";
type Message = { kind: Kind; status: string; alert: string | null };
type Pending = { kind: Kind; entry: AccessEntry; opener: HTMLElement | null };

/** The add fields for one list. Calls onAdded with the stored value once the entry has been added. */
function AddEntryForm({ kind, onAdded }: { kind: Kind; onAdded: (value: string) => void }) {
  const t = useMessages();
  const a = t.admin.access;
  const id = useId();
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (adding) return;
    setAdding(true);
    setFieldError(null);
    setAlert(null);
    let result: Awaited<ReturnType<typeof addAllowed>>;
    try {
      result = await addAllowed({ kind, value, note });
    } catch {
      result = { error: "unknown" };
    }
    setAdding(false);
    if ("ok" in result) onAdded(result.value);
    else if (result.error === "invalid") setFieldError(kind === "domain" ? a.errors.invalidDomain : a.errors.invalidEmail);
    else if (result.error === "duplicate") setFieldError(a.errors.duplicate);
    else setAlert(result.error === "forbidden" ? t.admin.users.errors.forbidden : a.errors.unknown);
  }

  const errorId = `${id}-error`;
  return (
    <form onSubmit={add} noValidate className="space-y-3">
      <div className="space-y-1">
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
      <div className="space-y-1">
        <label htmlFor={`${id}-note`} className="block text-sm font-medium">{a.note}</label>
        <input
          id={`${id}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
        />
      </div>
      {alert && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm">{alert}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={adding} aria-busy={adding} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50">
          {a.add}
        </button>
      </div>
    </form>
  );
}

function ListCard({ kind, icon: Icon, title, addTitle, entries, status, alert, onAdded, onRemove }: {
  kind: Kind;
  icon: LucideIcon;
  title: string;
  addTitle: string;
  entries: AccessEntry[];
  /** The result of the last add or remove in this list, shown here so it appears next to the action. */
  status: string;
  alert: string | null;
  onAdded: (value: string) => void;
  onRemove: (kind: Kind, entry: AccessEntry, opener: HTMLElement) => void;
}) {
  const t = useMessages();
  const a = t.admin.access;
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby={`${id}-title`} className="overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 id={`${id}-title`} className="flex items-center gap-2 text-base font-semibold">
          <Icon size={20} aria-hidden="true" className="shrink-0 text-accent" />
          {title}
        </h2>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:opacity-90"
        >
          <Plus size={16} aria-hidden="true" />
          {a.add}
        </button>
      </header>
      <Dialog title={addTitle} open={open} onClose={() => setOpen(false)}>
        <AddEntryForm
          kind={kind}
          onAdded={(value) => {
            setOpen(false);
            onAdded(value);
          }}
        />
      </Dialog>
      <p role="status" className={status ? "border-b border-line px-4 py-2 text-sm text-ink-2" : "sr-only"}>{status}</p>
      {alert && <p role="alert" className="mx-4 my-3 rounded-md bg-danger-soft px-3 py-2 text-sm">{alert}</p>}
      {entries.length === 0 ? (
        <EmptyState icon={Icon} title={a.empty} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-sunk text-left text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{a.columns.entry}</th>
                <th scope="col" className="px-3 py-2 font-medium">{a.columns.note}</th>
                <th scope="col" className="px-3 py-2 font-medium">{a.columns.accounts}</th>
                <th scope="col" className="px-3 py-2 font-medium">{a.columns.added}</th>
                <th scope="col" className="w-12 px-3 py-2"><span className="sr-only">{t.admin.users.columns.actions}</span></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.value} className="border-t border-line first:border-t-0">
                  <td className="break-all px-3 py-2 font-mono">{entry.value}</td>
                  <td className="px-3 py-2 text-ink-2">{entry.note ?? ""}</td>
                  <td className="px-3 py-2">
                    <Badge tone={entry.accounts > 0 ? "accent" : "neutral"}>{fill(a.accounts, { n: entry.accounts })}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-2"><RelativeTime iso={entry.createdAt} /></td>
                  <td className="px-3 py-2 text-right">
                    <RowMenu
                      label={fill(t.admin.ui.actionsFor, { name: entry.value })}
                      items={[{ key: "remove", label: a.remove, icon: Trash2, tone: "danger", onSelect: (opener) => onRemove(kind, entry, opener) }]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function AccessLists({ domains, emails }: { domains: AccessEntry[]; emails: AccessEntry[] }) {
  const t = useMessages();
  const a = t.admin.access;
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>({ kind: "domain", status: "", alert: null });
  const clear = (kind: Kind) => setMessage({ kind, status: "", alert: null });

  function ask(kind: Kind, entry: AccessEntry, opener: HTMLElement) {
    clear(kind);
    setPending({ kind, entry, opener });
  }

  function close() {
    const opener = pending?.opener;
    setPending(null);
    if (opener) queueMicrotask(() => { if (opener.isConnected) opener.focus(); });
  }

  async function confirmRemove() {
    if (!pending || busy) return;
    const { kind, entry } = pending;
    setBusy(true);
    clear(kind);
    let result: Awaited<ReturnType<typeof removeAllowed>>;
    try {
      result = await removeAllowed({ kind, value: entry.value });
    } catch {
      result = { error: "unknown" };
    }
    setBusy(false);
    if ("ok" in result) setMessage({ kind, status: fill(a.removed, { value: entry.value }), alert: null });
    else setMessage({ kind, status: "", alert: result.error === "self_lockout" ? a.errors.selfLockout : result.error === "forbidden" ? t.admin.users.errors.forbidden : a.errors.unknown });
    close();
  }

  const added = (kind: Kind) => (value: string) => setMessage({ kind, status: fill(a.added, { value }), alert: null });
  const shown = (kind: Kind) => (message.kind === kind ? message : { kind, status: "", alert: null });
  return (
    <div className="space-y-4">
      <div className="grid items-start gap-6">{/* one card per row: five columns do not fit in half the width */}
        <ListCard kind="domain" icon={Globe} title={a.domains} addTitle={a.addDomain} entries={domains} status={shown("domain").status} alert={shown("domain").alert} onAdded={added("domain")} onRemove={ask} />
        <ListCard kind="email" icon={Mail} title={a.emails} addTitle={a.addEmail} entries={emails} status={shown("email").status} alert={shown("email").alert} onAdded={added("email")} onRemove={ask} />
      </div>
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
