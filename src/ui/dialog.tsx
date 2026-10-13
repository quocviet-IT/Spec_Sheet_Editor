"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useMessages } from "@/messages/client";

const FOCUSABLE = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
const FIELDS = "input:not(:disabled):not([type='hidden']), select:not(:disabled), textarea:not(:disabled)";

/**
 * A modal for forms. role="dialog" with aria-modal and a labelled title. Same focus handling as the existing
 * confirm dialogs: focus moves to the first field (or the first control when there is no field), Tab and
 * Shift+Tab stay inside, Esc calls onClose, and focus returns to the element that was focused when it opened.
 * With requireClose, Esc does nothing and only the close button closes it (for content that cannot be shown again,
 * such as a one-time password). Renders nothing while open is false.
 */
export function Dialog({ title, open, onClose, requireClose = false, children }: { title: string; open: boolean; onClose: () => void; requireClose?: boolean; children: ReactNode }) {
  return open ? <OpenDialog title={title} onClose={onClose} requireClose={requireClose}>{children}</OpenDialog> : null;
}

function OpenDialog({ title, onClose, requireClose, children }: { title: string; onClose: () => void; requireClose: boolean; children: ReactNode }) {
  const t = useMessages();
  const id = useId();
  const section = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement;
    const root = section.current;
    const target = root?.querySelector<HTMLElement>(FIELDS) ?? root?.querySelector<HTMLElement>(FOCUSABLE) ?? root;
    target?.focus();
    function onEscape(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape" || requireClose) return;
      e.preventDefault();
      closeRef.current();
    }
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("keydown", onEscape);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [requireClose]);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== "Tab") return;
    const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (controls.length === 0) {
      e.preventDefault();
      return;
    }
    const i = controls.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    const n = controls.length;
    // Focus on the dialog itself (index -1): Tab goes to the first control, Shift+Tab to the last.
    const next = i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + n) % n;
    controls[next]?.focus();
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault(); // a press on the backdrop keeps focus in the dialog
      }}
    >
      <section
        ref={section}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onKeyDown={onKeyDown}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-4 overflow-y-auto rounded-lg bg-surface p-6 text-ink shadow-xl outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-title`} className="text-lg font-bold">{title}</h2>
          <button
            type="button"
            aria-label={t.admin.ui.close}
            onClick={onClose}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-sunk hover:text-ink"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
