"use client";

import { Check, Plus, Send } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMessages } from "@/messages/client";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Dialog } from "@/ui/dialog";
import { attachFeedbackScreenshot, fileFeedback } from "./actions";
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  FEEDBACK_IMPACTS,
  FEEDBACK_KINDS,
  type FeedbackImpact,
  type FeedbackKind,
} from "./model";
import { pageLabelOf, pageRouteOf } from "./page-label";

const BUCKET = "feedback-screenshots";
const CONTROL = "rounded-md border border-line bg-surface px-3 py-2 text-sm hover:bg-sunk disabled:opacity-50";
const PRIMARY = "inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50";

type Phase = "form" | "sending" | "sent";

/**
 * The report form. `shot` is the picture taken before the dialog opened (null when it could not be taken);
 * `capturing` is true while that is still running. The form is remounted (key) for "Report something else".
 */
export function ReportDialog({
  shot,
  capturing,
  onClose,
  onAnother,
}: {
  shot: Blob | null;
  capturing: boolean;
  onClose: () => void;
  onAnother: () => void;
}) {
  const t = useMessages();
  const pathname = usePathname();
  const [kind, setKind] = useState<FeedbackKind>("broken");
  const [impact, setImpact] = useState<FeedbackImpact>("slows_work");
  const [description, setDescription] = useState("");
  const [keepShot, setKeepShot] = useState(true);
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [shotNotStored, setShotNotStored] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const showPreview = !capturing && !!shot && keepShot;

  // An object URL for the picture, set on the image directly and revoked when the picture changes or the dialog closes.
  useEffect(() => {
    const img = imgRef.current;
    if (!shot || !showPreview || !img) return;
    const url = URL.createObjectURL(shot);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [shot, showPreview]);

  // Read when the dialog opens, from the page behind it.
  const [page] = useState(() =>
    pageLabelOf(pathname, t, document.querySelector("[data-feedback-sheet]")?.getAttribute("data-feedback-sheet")),
  );

  const long = description.trim().length >= DESCRIPTION_MIN;
  const busy = phase === "sending";

  async function send() {
    setError(null);
    setPhase("sending");
    try {
      const filed = await fileFeedback({
        kind,
        impact,
        description,
        pageUrl: (location.pathname + location.search).slice(0, 500),
        pageRoute: pageRouteOf(pathname),
        pageLabel: page,
      });
      if (!("ok" in filed)) {
        setError(t.feedback.failed);
        setPhase("form");
        return;
      }
      if (shot && keepShot) {
        // A picture that fails never undoes the report. The folder takes one file and a client cannot delete it,
        // so the path is fixed once: an upload is never repeated under a new name, and only the attach is retried.
        try {
          const path = `${filed.id}/${crypto.randomUUID()}.png`;
          const { error: uploadError } = await supabaseBrowser().storage.from(BUCKET).upload(path, shot, { contentType: "image/png", upsert: false });
          if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw uploadError;
          let attached = await attachFeedbackScreenshot(filed.id, path);
          if (!("ok" in attached)) attached = await attachFeedbackScreenshot(filed.id, path);
          if (!("ok" in attached)) throw new Error("attach");
        } catch {
          setShotNotStored(true);
        }
      }
      setPhase("sent");
    } catch {
      setError(t.feedback.failed);
      setPhase("form");
    }
  }

  return (
    <Dialog title={t.feedback.dialogTitle} open onClose={onClose} requireClose={busy}>
      {phase === "sent" ? (
        <div className="space-y-4">
          <p role="status" className="text-sm">{t.feedback.thanks}</p>
          {shotNotStored && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm">{t.feedback.shotNotStored}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onAnother} className={`${CONTROL} inline-flex items-center gap-2`}>
              <Plus size={14} aria-hidden="true" />
              {t.feedback.another}
            </button>
            <button type="button" onClick={onClose} className={PRIMARY}>
              <Check size={14} aria-hidden="true" />
              {t.feedback.close}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (long && !busy) void send();
          }}
        >
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium">{t.feedback.kindLegend}</legend>
            {FEEDBACK_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                {t.feedback.kinds[k]}
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium">{t.feedback.impactLegend}</legend>
            {FEEDBACK_IMPACTS.map((i) => (
              <label key={i} className="flex items-center gap-2 text-sm">
                <input type="radio" name="impact" value={i} checked={impact === i} onChange={() => setImpact(i)} />
                {t.feedback.impacts[i]}
              </label>
            ))}
          </fieldset>

          <label className="block space-y-1">
            <span className="text-sm font-medium">{t.feedback.description}</span>
            <textarea
              rows={5}
              maxLength={DESCRIPTION_MAX}
              value={description}
              placeholder={t.feedback.placeholder}
              onChange={(e) => setDescription(e.target.value)}
              className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
            {description.length > 0 && !long && <span className="block text-sm text-ink-2">{t.feedback.tooShort}</span>}
          </label>

          <p className="text-sm text-ink-2">{t.feedback.filedFrom.replace("{page}", page)}</p>

          <div className="space-y-2">
            {capturing && <p role="status" className="text-sm text-ink-2">{t.feedback.capturing}</p>}
            {!capturing && !shot && <p className="text-sm text-ink-2">{t.feedback.captureFailed}</p>}
            {!capturing && shot && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={keepShot} onChange={(e) => setKeepShot(e.target.checked)} />
                  {t.feedback.sendShot}
                </label>
                {keepShot && <p className="text-sm text-ink-2">{t.feedback.shotPrivacy}</p>}
                {keepShot && (
                  // A blob URL held in this browser, never fetched from a server: next/image has nothing to optimise.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img ref={imgRef} alt={t.feedback.shotAlt} className="max-h-48 w-full rounded-md border border-line object-contain" />
                )}
              </>
            )}
          </div>

          {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm">{error}</p>}

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={CONTROL}>
              {t.common.cancel}
            </button>
            <button type="submit" disabled={!long || busy || capturing} className={PRIMARY}>
              <Send size={14} aria-hidden="true" />
              {busy ? t.feedback.sending : t.feedback.send}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
