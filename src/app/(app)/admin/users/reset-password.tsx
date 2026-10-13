"use client";

import { useActionState } from "react";
import { resetPassword, type ResetPasswordState } from "@/admin/user-actions";
import { useMessages } from "@/messages/client";
import { Dialog } from "@/ui/dialog";
import { IssuedPasswordNotice } from "./issued-password";

const initial: ResetPasswordState = { error: null, issued: null };

/**
 * The reset flow in a dialog, opened from the row menu: ask first (no browser dialogs), then show the new one-time
 * password once. The dialog returns focus to the element focused when it opened, which is the row's "..." button.
 */
export function ResetPasswordDialog({ userId, name, email, onClose }: { userId: string; name: string; email: string; onClose: () => void }) {
  const t = useMessages();
  const u = t.admin.users;
  const [state, action, pending] = useActionState(resetPassword, initial);
  const errors = { self_reset: u.errors.selfReset, not_password_account: u.errors.notPasswordAccount, unknown: u.errors.unknown } as const;
  return (
    <Dialog title={state.issued ? u.resetTitle : u.reset} open onClose={onClose} requireClose={state.issued !== null}>
      {state.issued ? (
        <IssuedPasswordNotice key={state.issued.tempPassword} issued={state.issued} />
      ) : (
        <form action={action} className="space-y-3 text-left">
          <input type="hidden" name="userId" value={userId} />
          <p className="text-sm font-medium">
            {name} <span className="font-mono text-xs font-normal text-ink-2">{email}</span>
          </p>
          <p className="text-sm">{u.resetConfirm}</p>
          {state.error && <p role="alert" className="text-sm text-danger">{errors[state.error]}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-2 text-sm hover:bg-sunk">
              {t.common.cancel}
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-ink disabled:opacity-60">
              {u.resetYes}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
