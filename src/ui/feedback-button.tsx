"use client";

import { MessageSquareWarning } from "lucide-react";
import { useRef, useState } from "react";
import { captureScreen } from "@/feedback/capture";
import { ReportDialog } from "@/feedback/report-dialog";
import { useMessages } from "@/messages/client";

/**
 * The header's report button. The picture is taken first, then the dialog opens over the page, so the
 * dialog is never in it; while the picture is still being drawn the dialog says so.
 */
export function FeedbackButton() {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [shot, setShot] = useState<Blob | null>(null);
  const [round, setRound] = useState(0);
  const latest = useRef(0);

  async function capture() {
    const mine = ++latest.current;
    setCapturing(true);
    setShot(null);
    const blob = await captureScreen();
    if (mine !== latest.current) return;
    setShot(blob);
    setCapturing(false);
  }

  function openDialog() {
    setRound((n) => n + 1);
    setOpen(true);
    void capture();
  }

  return (
    <span data-feedback-chrome>
      <button
        type="button"
        onClick={openDialog}
        aria-label={t.feedback.reportLabel}
        className="inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1 text-sm hover:bg-sunk"
      >
        <MessageSquareWarning size={16} aria-hidden="true" />
        <span className="hidden sm:inline">{t.feedback.report}</span>
      </button>
      {open && (
        <ReportDialog
          key={round}
          shot={shot}
          capturing={capturing}
          onClose={() => {
            latest.current++;
            setOpen(false);
            setShot(null);
            setCapturing(false);
          }}
          onAnother={() => {
            setRound((n) => n + 1);
            void capture();
          }}
        />
      )}
    </span>
  );
}
