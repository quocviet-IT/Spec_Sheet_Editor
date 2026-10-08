"use client";

import { useActionState } from "react";
import { signInWithPassword, type SignInState } from "@/auth/actions";
import { useMessages } from "@/messages/client";

const initial: SignInState = { error: null, email: "" };

const field = "w-full rounded-md border border-line bg-surface px-3 py-2";

export function PasswordSignInForm({ next, notice }: { next: string; notice: string | null }) {
  const t = useMessages();
  const [state, action, pending] = useActionState(signInWithPassword, initial);
  const errors = {
    invalid: t.login.errors.invalid,
    rate_limited: t.login.errors.rateLimited,
    unknown: t.login.errors.unknown,
    suspended: t.login.errors.suspended,
    not_permitted: t.login.errors.notPermitted,
  } as const;
  // One alert at a time: the reason the page was opened with, until the form has an answer of its own.
  const message = state === initial ? notice : state.error ? errors[state.error] : null;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {message && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
          {message}
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium">{t.login.email}</label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state.email} className={field} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium">{t.login.password}</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={field} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink hover:opacity-90 disabled:opacity-60"
      >
        {pending ? t.login.submitting : t.login.submit}
      </button>
    </form>
  );
}
