"use client";

import { UserPlus } from "lucide-react";
import { useState } from "react";
import type { IssuedPassword } from "@/admin/user-actions";
import { useMessages } from "@/messages/client";
import { Dialog } from "@/ui/dialog";
import { AddUserForm } from "./add-user-form";
import { IssuedPasswordNotice } from "./issued-password";

/** The "Add user" button with its dialog. When the account is made the form closes and the one-time password shows once. */
export function AddUser() {
  const t = useMessages();
  const u = t.admin.users;
  const [open, setOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedPassword | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:opacity-90"
      >
        <UserPlus size={16} aria-hidden="true" />
        {u.add}
      </button>
      <Dialog title={u.add} open={open} onClose={() => setOpen(false)}>
        <AddUserForm
          onCreated={(result) => {
            setOpen(false);
            setIssued(result);
          }}
        />
      </Dialog>
      <Dialog title={u.createdTitle} open={issued !== null} requireClose onClose={() => setIssued(null)}>
        {issued && <IssuedPasswordNotice key={issued.tempPassword} issued={issued} />}
      </Dialog>
    </>
  );
}
