"use client";

import { useActionState, useEffect, useRef } from "react";
import { createPasswordUser, type CreateUserState, type IssuedPassword } from "@/admin/user-actions";
import { useMessages } from "@/messages/client";

const initial: CreateUserState = { error: null, issued: null, values: { email: "", fullName: "", role: "user" } };
const field = "w-full rounded-md border border-line bg-surface px-3 py-2";

/** The add-user fields. Calls onCreated once with the one-time password when the account has been made. */
export function AddUserForm({ onCreated }: { onCreated: (issued: IssuedPassword) => void }) {
  const t = useMessages();
  const u = t.admin.users;
  const [state, action, pending] = useActionState(createPasswordUser, initial);
  const errors = {
    email_taken: u.errors.emailTaken,
    invalid_email: u.errors.invalidEmail,
    weak: u.errors.weak,
    name_required: u.errors.nameRequired,
    forbidden: u.errors.forbidden,
    unknown: u.errors.unknown,
  } as const;
  const message = state.error ? errors[state.error] : null;
  const created = useRef(onCreated);
  useEffect(() => {
    created.current = onCreated;
  });
  useEffect(() => {
    if (state.issued) created.current(state.issued);
  }, [state.issued]);
  return (
    <div className="space-y-3">
      {message && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
          {message}
        </p>
      )}
      <form action={action} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="block font-medium">{u.fullName}</span>
          <input name="fullName" required maxLength={120} autoComplete="off" defaultValue={state.values.fullName} className={field} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="block font-medium">{u.email}</span>
          <input name="email" type="email" required autoComplete="off" defaultValue={state.values.email} className={field} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="block font-medium">{u.role}</span>
          <select name="role" defaultValue={state.values.role} className={field}>
            <option value="user">{u.roles.user}</option>
            <option value="admin">{u.roles.admin}</option>
          </select>
        </label>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink hover:opacity-90 disabled:opacity-60"
          >
            {pending ? u.creating : u.create}
          </button>
        </div>
      </form>
    </div>
  );
}
