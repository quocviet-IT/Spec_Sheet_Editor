"use client";

import { Ban, Clock, Globe, KeyRound, RotateCcw, Search, SearchX, ShieldCheck, ShieldMinus, ShieldPlus, User, Users } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { DEFAULT_PAGE_SIZE, pageInfo } from "@/admin/paging";
import { setRole, setStatus } from "@/admin/user-actions";
import type { UserRow } from "@/admin/queries";
import { initials } from "@/admin/row-menu-keys";
import { filterUsers, type UserStatusFilter } from "@/admin/users-filter";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import { Badge } from "../ui/badge";
import { EmptyState } from "../ui/empty-state";
import { Pagination } from "../ui/pagination";
import { RelativeTime } from "../ui/relative-time";
import { RowMenu, type RowMenuItem } from "../ui/row-menu";
import { ResetPasswordDialog } from "./reset-password";

type Pending = { row: UserRow; kind: "role" | "status"; opener: HTMLElement | null };

export function ConfirmDialog({ message, confirmLabel, cancelLabel, busy, onConfirm, onCancel }: {
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
        aria-labelledby={`${id}-body`}
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
  const u = t.admin.users;
  const [rows, setRows] = useState(initialRows);
  // Follow the server's rows when they change (an account added, a password issued, a role or status changed
  // after the page was revalidated). Resetting state while rendering keeps filters, page and open dialogs, and the
  // instant local update after a change still shows until the fresh rows arrive.
  const [seenRows, setSeenRows] = useState(initialRows);
  if (seenRows !== initialRows) {
    setSeenRows(initialRows);
    setRows(initialRows);
  }
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRoleFilter] = useState<"all" | "user" | "admin">("all");
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("all");
  const [paging, setPaging] = useState({ page: 1, size: DEFAULT_PAGE_SIZE });
  const [pending, setPending] = useState<Pending | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(input.trim());
      setPaging((p) => ({ ...p, page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [input]);

  const filtered = filterUsers(rows, { query, role, status: statusFilter });
  const info = pageInfo(filtered.length, paging.page, paging.size);
  const visible = filtered.slice(info.from === 0 ? 0 : info.from - 1, info.to);
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

  function menuItems(row: UserRow, mine: boolean): RowMenuItem[] {
    const items: RowMenuItem[] = [
      {
        key: "role",
        label: row.role === "admin" ? u.makeStaff : u.makeAdmin,
        icon: row.role === "admin" ? ShieldMinus : ShieldPlus,
        onSelect: (opener) => ask(row, "role", opener),
      },
    ];
    if (row.passwordAccount && !mine) {
      items.push({ key: "reset", label: u.reset, icon: KeyRound, onSelect: () => setResetting(row) });
    }
    if (!mine) {
      const active = row.status === "active";
      items.push({
        key: "status",
        label: active ? u.suspend : u.reinstate,
        icon: active ? Ban : RotateCcw,
        tone: active ? "danger" : undefined,
        separatorBefore: true,
        onSelect: (opener) => ask(row, "status", opener),
      });
    }
    return items;
  }

  const select = "rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={u.search}
            aria-label={u.search}
            className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          aria-label={u.filters.role}
          value={role}
          onChange={(e) => {
            setRoleFilter(e.target.value as "all" | "user" | "admin");
            setPaging((p) => ({ ...p, page: 1 }));
          }}
          className={select}
        >
          <option value="all">{u.filters.allRoles}</option>
          <option value="admin">{u.roles.admin}</option>
          <option value="user">{u.roles.user}</option>
        </select>
        <select
          aria-label={u.filters.status}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as UserStatusFilter);
            setPaging((p) => ({ ...p, page: 1 }));
          }}
          className={select}
        >
          <option value="all">{u.filters.allStatuses}</option>
          <option value="active">{u.status.active}</option>
          <option value="suspended">{u.status.suspended}</option>
          <option value="waiting">{u.status.waiting}</option>
        </select>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {visible.length === 0 ? (
          rows.length === 0 ? (
            <EmptyState icon={Users} title={u.none} />
          ) : (
            <EmptyState icon={SearchX} title={query ? fill(u.noMatch, { q: query }) : u.noMatchFilters} />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-sunk text-left text-ink-2">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{u.columns.user}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{u.columns.role}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{u.columns.status}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{u.columns.lastSeen}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{u.sheets}</th>
                  <th scope="col" className="w-12 px-3 py-2"><span className="sr-only">{u.columns.actions}</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const mine = row.id === meId;
                  const label = row.fullName ?? row.email;
                  const method = row.passwordAccount ? u.signIn.password : u.signIn.google;
                  const SignInIcon = row.passwordAccount ? KeyRound : Globe;
                  const waiting = row.status === "active" && row.passwordAccount && row.mustChangePassword;
                  return (
                    <tr key={row.id} className="border-t border-line first:border-t-0">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${row.role === "admin" ? "bg-accent-soft text-accent" : "bg-sunk text-ink-2"}`}
                          >
                            {initials(row.fullName, row.email)}
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium">
                              {label}
                              {mine && <span className="font-normal text-ink-3"> {u.you}</span>}
                            </div>
                            <div className="flex items-center gap-1 text-xs text-ink-2">
                              <span role="img" aria-label={`${u.columns.signIn}: ${method}`} title={`${u.columns.signIn}: ${method}`} className="inline-flex">
                                <SignInIcon size={16} aria-hidden="true" />
                              </span>
                              <span className="font-mono">{row.email}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {row.role === "admin" ? (
                          <Badge tone="admin" icon={ShieldCheck}>{u.roles.admin}</Badge>
                        ) : (
                          <Badge tone="neutral" icon={User}>{u.roles.user}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.status === "suspended" ? (
                          <Badge tone="danger" icon={Ban}>{u.status.suspended}</Badge>
                        ) : waiting ? (
                          <Badge tone="warning" icon={Clock}>{u.status.waiting}</Badge>
                        ) : (
                          <Badge tone="success">{u.status.active}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink-2">
                        {row.lastSeenAt ? <RelativeTime iso={row.lastSeenAt} /> : u.never}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.sheets}</td>
                      <td className="px-3 py-2 text-right">
                        <RowMenu label={fill(t.admin.ui.actionsFor, { name: label })} items={menuItems(row, mine)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > 0 && <Pagination info={info} onChange={(page, size) => setPaging({ page, size })} />}
      </div>
      <p role="status" className="text-sm text-ink-2">{saved ? u.changed : ""}</p>
      {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm">{error}</p>}
      {resetting && (
        <ResetPasswordDialog
          userId={resetting.id}
          name={resetting.fullName ?? resetting.email}
          email={resetting.email}
          onClose={() => setResetting(null)}
        />
      )}
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
