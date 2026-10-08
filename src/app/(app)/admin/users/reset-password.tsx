"use client";

import { useActionState, useState } from "react";
import { resetPassword, type ResetPasswordState } from "@/admin/user-actions";
import { useMessages } from "@/messages/client";
import { IssuedPasswordNotice } from "./issued-password";

const initial: ResetPasswordState = { error: null, issued: null };

/** A two-step control: ask first (no browser dialogs), then show the new one-time password once. */
export function ResetPasswordButton({ userId }: { userId: string }) {
  const t = useMessages();
  const u = t.admin.users;
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(resetPassword, initial);
  if (state.issued) return <IssuedPasswordNotice title={u.resetTitle} issued={state.issued} />;
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="rounded border border-line px-3 py-1 hover:bg-sunk">
        {u.reset}
      </button>
    );
  }
  const errors = { self_reset: u.errors.selfReset, not_password_account: u.errors.notPasswordAccount, unknown: u.errors.unknown } as const;
  return (
    <form action={action} className="space-y-2 text-left">
      <input type="hidden" name="userId" value={userId} />
      <p className="text-sm">{u.resetConfirm}</p>
      {state.error && <p role="alert" className="text-sm text-danger">{errors[state.error]}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="rounded bg-accent px-3 py-1 font-semibold text-accent-ink disabled:opacity-60">
          {u.resetYes}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="rounded border border-line px-3 py-1 hover:bg-sunk">
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
