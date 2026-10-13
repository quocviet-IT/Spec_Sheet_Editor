"use client";

import { useEffect } from "react";
import { useMessages } from "@/messages/client";

/** UC-02 exception 1b, and any signed-in page whose data could not be read: a message and "Try again", under the header. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useMessages();
  useEffect(() => {
    console.error("Page failed to load:", error.digest ?? error.message);
  }, [error]);
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface px-4 py-6">
      <p role="alert">{t.common.loadFailed}</p>
      <button type="button" onClick={() => retry()} className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink hover:opacity-90">
        {t.common.tryAgain}
      </button>
    </section>
  );
}
