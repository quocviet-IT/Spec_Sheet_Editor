"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { checkFile, mimeOf, ratioMatches, type SourceType } from "@/lib/form/template";
import { encodeThumbnail, PageError, renderSource, trimPage } from "@/lib/page/render";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { fill } from "@/messages/format";
import { useMessages } from "@/messages/client";
import { createSheet } from "@/sheets/actions";
import { defaultSheetName, fileLabel } from "@/sheets/format";
import type { UploadSettings } from "@/sheets/types";

type Prepared = { id: string; file: File; sourceType: SourceType; thumb: Blob; width: number; height: number; pageCount: number };
type ErrorCode = "wrongType" | "tooLarge" | "pdfLocked" | "pdfDamaged" | "imageUnreadable" | "wrongTemplate" | "uploadFailed" | "createFailed";
type Stage = "pick" | "reading" | "ready" | "uploading" | "error";

const STEP_ORDER = ["check", "read", "template", "store", "record"] as const;

/** Storage answers 409 / "already exists" when a retry finds the file stored the first time. */
function alreadyStored(error: { message?: string; status?: number; statusCode?: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.status === 409 || error.statusCode === "409" || error.code === "ResourceAlreadyExists" || /exist/i.test(error.message ?? "");
}

export function UploadDialog({ settings, onClose }: { settings: UploadSettings; onClose: () => void }) {
  const t = useMessages();
  const u = t.upload;
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [stage, setStage] = useState<Stage>("pick");
  const [step, setStep] = useState(0);
  const [error, setError] = useState<{ code: ErrorCode; n?: number } | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState(false);

  async function prepare(file: File) {
    setError(null);
    setStage("reading");
    setStep(0);
    const checked = checkFile(file, settings.maxFileMb);
    if (!checked.ok) {
      setError(checked.reason === "too_large" ? { code: "tooLarge", n: checked.sizeMb } : { code: "wrongType" });
      setStage("error");
      return;
    }
    setStep(1);
    try {
      const page = await renderSource(file, checked.sourceType);
      setStep(2);
      const trimmed = trimPage(page);
      if (!ratioMatches(trimmed.width, trimmed.height, settings.aspectTolerancePct)) {
        setError({ code: "wrongTemplate" });
        setStage("error");
        return;
      }
      const thumb = await encodeThumbnail(trimmed);
      setPrepared({ id: crypto.randomUUID(), file, sourceType: checked.sourceType, thumb, width: trimmed.width, height: trimmed.height, pageCount: page.pageCount });
      setName(defaultSheetName(file.name, u.defaultName));
      setStep(3);
      setStage("ready");
    } catch (e) {
      const code = e instanceof PageError ? e.code : "image_unreadable";
      setError({ code: code === "pdf_locked" ? "pdfLocked" : code === "pdf_damaged" ? "pdfDamaged" : "imageUnreadable" });
      setStage("error");
    }
  }

  async function upload() {
    if (!prepared) return;
    setError(null);
    setStage("uploading");
    setStep(3);
    const bucket = supabaseBrowser().storage.from("spec-sheets");
    const source = await bucket.upload(`${prepared.id}/source.${prepared.sourceType}`, prepared.file, { contentType: mimeOf(prepared.sourceType), upsert: false });
    if (source.error && !alreadyStored(source.error)) return fail("uploadFailed");
    const thumb = await bucket.upload(`${prepared.id}/thumb.jpg`, prepared.thumb, { contentType: "image/jpeg", upsert: false });
    if (thumb.error && !alreadyStored(thumb.error)) return fail("uploadFailed");
    setStep(4);
    const created = await createSheet({ id: prepared.id, name: name.trim() || u.defaultName, sourceType: prepared.sourceType, pageW: prepared.width, pageH: prepared.height });
    if ("error" in created) return fail(created.error === "files_missing" ? "uploadFailed" : "createFailed");
    router.push(`/sheets/${created.id}`);
  }

  function fail(code: ErrorCode) {
    setError({ code });
    setStage("ready");
  }

  function reset() {
    setPrepared(null);
    setError(null);
    setStage("pick");
    if (input.current) input.current.value = "";
  }

  const message = error ? fill(u.errors[error.code], { n: error.n ?? "", max: settings.maxFileMb }) : null;
  const lowRes = prepared && prepared.width < settings.lowresWarnPx;

  return (
    <div className="fixed inset-0 z-30 flex overflow-y-auto bg-ink/50 px-4 py-6">
      <section role="dialog" aria-modal="true" aria-labelledby="upload-title" className="m-auto w-full max-w-xl space-y-4 rounded-xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 id="upload-title" className="text-xl font-bold">{u.title}</h2>
          <button type="button" onClick={onClose} aria-label={u.close} className="rounded px-2 py-1 text-xl leading-none hover:bg-sunk">×</button>
        </div>

        {(stage === "pick" || stage === "error") && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) void prepare(f);
            }}
            className={"space-y-3 rounded-lg border-2 border-dashed p-8 text-center " + (dragging ? "border-accent bg-accent-soft" : "border-line bg-paper")}
          >
            <p className="font-semibold">{u.drop}</p>
            <p className="text-sm text-ink-2">{fill(u.limits, { max: settings.maxFileMb })}</p>
            <input
              ref={input}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              className="sr-only"
              id="upload-file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void prepare(f); }}
            />
            <label htmlFor="upload-file" className="inline-block cursor-pointer rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink hover:opacity-90">
              {u.choose}
            </label>
            <p className="text-xs text-ink-2">{u.photoNote}</p>
          </div>
        )}

        {stage !== "pick" && stage !== "error" && (
          <ol className="space-y-1 text-sm">
            {STEP_ORDER.map((key, i) => (
              <li key={key} className="flex items-center gap-2">
                <span aria-hidden className={"inline-block h-4 w-4 rounded-full " + (i < step ? "bg-accent" : i === step && stage !== "ready" ? "animate-pulse bg-accent-soft" : "border border-line")} />
                <span className={i <= step ? "" : "text-ink-3"}>{u.steps[key]}</span>
              </li>
            ))}
          </ol>
        )}

        {message && <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">{message}</p>}

        {prepared && (stage === "ready" || stage === "uploading") && (
          <div className="space-y-3">
            <p className="font-mono text-xs text-ink-2">{prepared.file.name} · {fileLabel(prepared.sourceType, prepared.width, prepared.height)}</p>
            {prepared.pageCount > 1 && <p className="rounded-md bg-accent-soft px-3 py-2 text-sm">{fill(u.multiPage, { n: prepared.pageCount })}</p>}
            {lowRes && <p className="rounded-md bg-warn-soft px-3 py-2 text-sm">{fill(u.lowRes, { w: prepared.width })}</p>}
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{u.name}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className="w-full rounded-md border border-line bg-surface px-3 py-2" />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={reset} disabled={stage === "uploading"} className="rounded-md border border-line px-4 py-2 hover:bg-sunk disabled:opacity-60">
                {u.another}
              </button>
              <button type="button" onClick={() => void upload()} disabled={stage === "uploading"} className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink hover:opacity-90 disabled:opacity-60">
                {stage === "uploading" ? u.uploading : error ? t.sheets.retry : u.start}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
