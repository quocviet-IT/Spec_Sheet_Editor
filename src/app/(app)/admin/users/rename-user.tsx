"use client";

import { useState, type FormEvent } from "react";
import { renameUser, type RenameError } from "@/admin/user-actions";
import { useMessages } from "@/messages/client";
import { Dialog } from "@/ui/dialog";

const field = "w-full rounded-md border border-line bg-surface px-3 py-2";

/**
 * Renames a password account, opened from the row menu. The field starts with the current name; the same name
 * again closes the dialog without asking the server. The dialog returns focus to the row's "..." button.
 */
export function RenameUserDialog({ userId, current, email, onRenamed, onClose }: {
  userId: string;
  current: string | null;
  email: string;
  onRenamed: (fullName: string) => void;
  onClose: () => void;
}) {
  const t = useMessages();
  const u = t.admin.users;
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RenameError | null>(null);
  const errors: Record<RenameError, string> = {
    name_required: u.errors.nameRequired,
    not_password_account: u.errors.googleName,
    forbidden: u.errors.forbidden,
    not_found: u.errors.notFound,
    unknown: u.errors.unknown,
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fullName = value.trim();
    if (fullName === "" || fullName.length > 120) {
      setError("name_required");
      return;
    }
    if (fullName === (current ?? "").trim()) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    let result: Awaited<ReturnType<typeof renameUser>>;
    try {
      result = await renameUser({ userId, fullName });
    } catch {
      result = { error: "unknown" };
    }
    setBusy(false);
    if ("error" in result) setError(result.error);
    else onRenamed(result.fullName);
  }

  return (
    <Dialog title={u.renameTitle} open onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} noValidate className="space-y-3 text-left">
        <p className="font-mono text-xs text-ink-2">{email}</p>
        <label className="block space-y-1 text-sm">
          <span className="block font-medium">{u.fullName}</span>
          <input
            name="fullName"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            maxLength={120}
            autoComplete="off"
            aria-invalid={error === "name_required"}
            className={field}
          />
        </label>
        <p className="text-sm text-ink-2">{u.renameLead}</p>
        {error && <p role="alert" className="text-sm text-danger">{errors[error]}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-line px-3 py-2 text-sm hover:bg-sunk disabled:opacity-60">
            {t.common.cancel}
          </button>
          <button type="submit" disabled={busy} aria-busy={busy} className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60">
            {u.renameSave}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
