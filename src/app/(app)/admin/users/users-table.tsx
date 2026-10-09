"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { setRole, setStatus } from "@/admin/user-actions";
import type { UserRow } from "@/admin/queries";
import { useLocale, useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import { ResetPasswordButton } from "./reset-password";

type Pending = { row: UserRow; kind: "role" | "status"; opener: HTMLElement | null };

function ConfirmDialog({ message, confirmLabel, cancelLabel, busy, onConfirm, onCancel }: {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  useEffect(() => {
    cancelRef.current = onCancel;
    busyRef.current = busy;
  });
  useEffect(() => {
    cancel.current?.focus();
    function onEscape(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (!busyRef.current) cancelRef.current();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "Tab") return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <section
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-describedby={`${id}-body`}
        onKeyDown={onKeyDown}
        className="w-full max-w-md space-y-4 rounded-lg bg-surface p-6 text-ink shadow-xl outline-none"
      >
        <p id={`${id}-body`} className="text-sm">{message}</p>
        <div className="flex justify-end gap-2">
          <button ref={cancel} type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50">{cancelLabel}</button>
          <button type="button" onClick={onConfirm} disabled={busy} aria-busy={busy} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50">{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

export function UsersTable({ rows: initialRows, meId }: { rows: UserRow[]; meId: string }) {
  const t = useMessages();
  const locale = useLocale();
  const u = t.admin.users;
  const [rows, setRows] = useState(initialRows);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const when = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const visible = query
    ? rows.filter((r) => r.email.toLowerCase().includes(query) || (r.fullName ?? "").toLowerCase().includes(query))
    : rows;
  const errors: Record<string, string> = {
    last_admin: u.errors.lastAdmin,
    self_suspend: u.errors.selfSuspend,
    forbidden: u.errors.forbidden,
    not_found: u.errors.notFound,
    unknown: u.errors.unknown,
  };

  function ask(row: UserRow, kind: "role" | "status", opener: HTMLElement) {
    setSaved(false);
    setError(null);
    setPending({ row, kind, opener });
  }

  function close() {
    const opener = pending?.opener;
    setPending(null);
    if (opener) queueMicrotask(() => { if (opener.isConnected) opener.focus(); });
  }

  async function confirm() {
    if (!pending || busy) return;
    const { row, kind } = pending;
    setBusy(true);
    let result: { ok: true } | { error: string };
    try {
      result =
        kind === "role"
          ? await setRole({ userId: row.id, role: row.role === "admin" ? "user" : "admin" })
          : await setStatus({ userId: row.id, status: row.status === "active" ? "suspended" : "active" });
    } catch {
      result = { error: "unknown" };
    }
    setBusy(false);
    if ("error" in result) {
      setError(errors[result.error] ?? u.errors.unknown);
    } else {
      setRows((all) =>
        all.map((r) => {
          if (r.id !== row.id) return r;
          if (kind === "role") return { ...r, role: r.role === "admin" ? "user" : "admin" };
          return { ...r, status: r.status === "active" ? "suspended" : "active" };
        }),
      );
      setSaved(true);
    }
    close();
  }

  const name = pending ? (pending.row.fullName ?? pending.row.email) : "";
  let message = "";
  let confirmLabel = "";
  if (pending) {
    const r = pending.row;
    if (pending.kind === "role") {
      message = fill(u.roleConfirm, { name, role: u.roles[r.role === "admin" ? "user" : "admin"] });
      confirmLabel = r.role === "admin" ? u.makeStaff : u.makeAdmin;
    } else {
      message = fill(r.status === "active" ? u.suspendConfirm : u.reinstateConfirm, { name });
      confirmLabel = r.status === "active" ? u.suspend : u.reinstate;
    }
  }

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={u.search}
        aria-label={u.search}
        className="w-full max-w-sm rounded-md border border-line bg-surface px-3 py-2 text-sm"
      />
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-sunk text-left text-ink-2">
            <tr>
              <th className="px-3 py-2 font-medium">{u.columns.user}</th>
              <th className="px-3 py-2 font-medium">{u.columns.role}</th>
              <th className="px-3 py-2 font-medium">{u.columns.status}</th>
              <th className="px-3 py-2 font-medium">{u.columns.signIn}</th>
              <th className="px-3 py-2 font-medium">{u.columns.lastSeen}</th>
              <th className="px-3 py-2 text-right font-medium">{u.sheets}</th>
              <th className="px-3 py-2"><span className="sr-only">{u.columns.actions}</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr className="border-t border-line">
                <td colSpan={7} className="px-3 py-4 text-ink-2">{fill(u.noMatch, { q: input.trim() })}</td>
              </tr>
            )}
            {visible.map((row) => {
              const mine = row.id === meId;
              const roleLabel = row.role === "admin" ? u.makeStaff : u.makeAdmin;
              const statusLabel = row.status === "active" ? u.suspend : u.reinstate;
              return (
                <tr key={row.id} className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {row.fullName ?? row.email}
                      {mine && <span className="font-normal text-ink-3"> {u.you}</span>}
                    </div>
                    <div className="font-mono text-xs text-ink-2">{row.email}</div>
                  </td>
                  <td className="px-3 py-2">{u.roles[row.role]}</td>
                  <td className="px-3 py-2">
                    {u.status[row.status]}
                    {row.mustChangePassword && (
                      <span className="ml-2 whitespace-nowrap rounded bg-warn-soft px-1.5 py-0.5 text-xs">{u.mustChange}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.passwordAccount ? u.signIn.password : u.signIn.google}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.lastSeenAt ? when.format(new Date(row.lastSeenAt)) : u.never}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.sheets}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" onClick={(e) => ask(row, "role", e.currentTarget)} aria-label={`${roleLabel}: ${row.email}`} className="rounded border border-line px-3 py-1 hover:bg-sunk">
                        {roleLabel}
                      </button>
                      {!mine && (
                        <button type="button" onClick={(e) => ask(row, "status", e.currentTarget)} aria-label={`${statusLabel}: ${row.email}`} className="rounded border border-line px-3 py-1 hover:bg-sunk">
                          {statusLabel}
                        </button>
                      )}
                      {row.passwordAccount && !mine && <ResetPasswordButton userId={row.id} email={row.email} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p role="status" className="text-sm text-ink-2">{saved ? u.changed : ""}</p>
      {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm">{error}</p>}
      {pending && (
        <ConfirmDialog
          message={message}
          confirmLabel={confirmLabel}
          cancelLabel={t.common.cancel}
          busy={busy}
          onConfirm={confirm}
          onCancel={close}
        />
      )}
    </div>
  );
}
