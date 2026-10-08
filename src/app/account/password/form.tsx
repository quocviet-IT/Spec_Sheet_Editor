"use client";

import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "@/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/auth/password";
import { useMessages } from "@/messages/client";

const initial: ChangePasswordState = { error: null };
const field = "w-full rounded-md border border-line bg-surface px-3 py-2";

export function ChangePasswordForm({ next }: { next: string }) {
  const t = useMessages();
  const m = t.account.password;
  const [state, action, pending] = useActionState(changePassword, initial);
  const errors = {
    too_short: m.errors.tooShort,
    mismatch: m.errors.mismatch,
    same: m.errors.same,
    weak: m.errors.weak,
    reauth: m.errors.reauth,
    unknown: m.errors.unknown,
  } as const;
  const message = state.error ? errors[state.error] : null;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {message && (
        <p id="password-error" role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
          {message}
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium">{m.newPassword}</label>
        <input
          id="password" name="password" type="password" autoComplete="new-password" required
          minLength={MIN_PASSWORD_LENGTH} className={field}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? "password-rule password-error" : "password-rule"}
        />
        <p id="password-rule" className="text-xs text-ink-2">{m.rule}</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirm" className="block text-sm font-medium">{m.confirm}</label>
        <input
          id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} className={field}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? "password-error" : undefined}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink hover:opacity-90 disabled:opacity-60"
      >
        {pending ? m.submitting : m.submit}
      </button>
    </form>
  );
}
