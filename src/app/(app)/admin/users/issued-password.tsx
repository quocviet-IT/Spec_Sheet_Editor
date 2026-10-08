"use client";

import { useState } from "react";
import type { IssuedPassword } from "@/admin/user-actions";
import { useMessages } from "@/messages/client";

/** Shows a one-time password once, with a copy button; it is never stored by the app. */
export function IssuedPasswordNotice({ title, issued }: { title: string; issued: IssuedPassword }) {
  const t = useMessages();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.tempPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div role="status" className="space-y-2 rounded-md border border-accent bg-accent-soft p-3 text-left text-sm">
      <p className="font-semibold">
        {title}: <span className="font-mono">{issued.email}</span>
      </p>
      <p className="text-ink-2">{t.admin.users.tempLead}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="select-all rounded bg-surface px-2 py-1 font-mono text-base tracking-wider">{issued.tempPassword}</code>
        <button type="button" onClick={copy} className="rounded border border-line bg-surface px-3 py-1 hover:bg-sunk">
          {copied ? t.common.copied : t.common.copy}
        </button>
      </div>
    </div>
  );
}
