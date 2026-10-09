"use client";

import { useMessages } from "@/messages/client";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useMessages();
  return (
    <section role="alert" className="space-y-4">
      <p>{t.admin.users.errors.unknown}</p>
      <button type="button" onClick={reset} className="rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-sunk">
        {t.editor.tryAgain}
      </button>
    </section>
  );
}
