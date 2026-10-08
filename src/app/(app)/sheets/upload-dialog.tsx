"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { checkFile, mimeOf, ratioMatches, type SourceType } from "@/lib/form/template";
import { encodeThumbnail, PageError, renderSource, trimPage } from "@/lib/page/render";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { fill } from "@/messages/format";
import { useMessages } from "@/messages/client";
import { createSheet } from "@/sheets/actions";
import { defaultSheetName, fileLabel } from "@/sheets/format";
import type { UploadSettings } from "@/sheets/types";

type Prepared = { id: string; file: File; sourceType: SourceType; thumb: Blob; width: number; height: number; pageCount: number };
type ErrorCode = "oneFile" | "wrongType" | "tooLarge" | "pdfLocked" | "pdfDamaged" | "imageUnreadable" | "wrongTemplate" | "uploadFailed" | "createFailed";
type Stage = "pick" | "reading" | "ready" | "uploading" | "error";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

const STEP_ORDER = ["check", "read", "template", "store", "record"] as const;

/** Storage answers 409 / "already exists" when a retry finds the file stored the first time. */
function alreadyStored(error: { message?: string; status?: number; statusCode?: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.status === 409 || error.statusCode === "409" || error.code === "ResourceAlreadyExists" || /already exists/i.test(error.message ?? "");
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
  const mounted = useRef(true);
  const dialog = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus();
    const stop = (e: Event) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      mounted.current = false;
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (dialog.current && !dialog.current.contains(document.activeElement)) heading.current?.focus();
  }, [stage]);

  function chosen(files: FileList | null | undefined) {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      setError({ code: "oneFile" });
      setStage("error");
      return;
    }
    void prepare(files[0]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (stage !== "uploading") {
        e.stopPropagation();
        onClose();
      }
      return;
    }
    if (e.key !== "Tab" || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialog.current.contains(active) || active === heading.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialog.current.contains(active) || active === heading.current)) {
      e.preventDefault();
      first.focus();
    }
  }

  async function prepare(file: File) {
    try {
      await prepareInner(file);
    } catch {
      if (!mounted.current) return;
      setError({ code: "imageUnreadable" });
      setStage("error");
    }
  }

  async function prepareInner(file: File) {
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
      if (!mounted.current) return;
      setStep(2);
      const trimmed = trimPage(page);
      if (!ratioMatches(trimmed.width, trimmed.height, settings.aspectTolerancePct)) {
        setError({ code: "wrongTemplate" });
        setStage("error");
        return;
      }
      const thumb = await encodeThumbnail(trimmed);
      if (!mounted.current) return;
      setPrepared({ id: crypto.randomUUID(), file, sourceType: checked.sourceType, thumb, width: trimmed.width, height: trimmed.height, pageCount: page.pageCount });
      setName(defaultSheetName(file.name, u.defaultName));
      setStep(3);
      setStage("ready");
    } catch (e) {
      if (!mounted.current) return;
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
    let stored = false;
    try {
      const bucket = supabaseBrowser().storage.from("spec-sheets");
      const source = await bucket.upload(`${prepared.id}/source.${prepared.sourceType}`, prepared.file, { contentType: mimeOf(prepared.sourceType), upsert: false });
      if (source.error && !alreadyStored(source.error)) return fail("uploadFailed");
      const thumb = await bucket.upload(`${prepared.id}/thumb.jpg`, prepared.thumb, { contentType: "image/jpeg", upsert: false });
      if (thumb.error && !alreadyStored(thumb.error)) return fail("uploadFailed");
      stored = true;
      if (!mounted.current) return;
      setStep(4);
      const created = await createSheet({ id: prepared.id, name: name.trim() || u.defaultName, sourceType: prepared.sourceType, pageW: prepared.width, pageH: prepared.height });
      if ("error" in created) return fail(created.error === "files_missing" ? "uploadFailed" : "createFailed");
      if (!mounted.current) return;
      router.push(`/sheets/${created.id}`);
    } catch {
      fail(stored ? "createFailed" : "uploadFailed");
    }
  }

  function fail(code: ErrorCode) {
    if (!mounted.current) return;
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
      <section ref={dialog} onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-labelledby="upload-title" className="m-auto w-full max-w-xl space-y-4 rounded-xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 id="upload-title" ref={heading} tabIndex={-1} className="text-xl font-bold">{u.title}</h2>
          <button type="button" onClick={onClose} disabled={stage === "uploading"} aria-label={u.close} className="rounded px-2 py-1 text-xl leading-none hover:bg-sunk disabled:opacity-60">×</button>
        </div>

        {(stage === "pick" || stage === "error") && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              chosen(e.dataTransfer.files);
            }}
            className={"space-y-3 rounded-lg border-2 border-dashed p-8 text-center " + (dragging ? "border-accent bg-accent-soft" : "border-line bg-paper")}
          >
            <p className="font-semibold">{u.drop}</p>
            <p className="text-sm text-ink-2">{fill(u.limits, { max: settings.maxFileMb })}</p>
            <input
              ref={input}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              className="peer sr-only"
              id="upload-file"
              onChange={(e) => chosen(e.target.files)}
            />
            <label htmlFor="upload-file" className="inline-block cursor-pointer rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink hover:opacity-90 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
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
