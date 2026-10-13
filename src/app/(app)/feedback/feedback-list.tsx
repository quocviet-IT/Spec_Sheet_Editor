"use client";

import { MessageSquareWarning } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PageInfo } from "@/admin/paging";
import { declineNeedsNote, FEEDBACK_STATUSES, NOTE_MAX, type FeedbackStatus } from "@/feedback/model";
import { feedbackHref } from "@/feedback/list-url";
import { markFeedbackSeen, setFeedbackStatus } from "@/feedback/actions";
import type { FeedbackRow } from "@/feedback/queries";
import { useMessages } from "@/messages/client";
import { Pagination } from "@/ui/pagination";
import { Badge, type BadgeTone } from "../admin/ui/badge";
import { EmptyState } from "../admin/ui/empty-state";
import { RelativeTime } from "../admin/ui/relative-time";

const TONES: Record<FeedbackStatus, BadgeTone> = { new: "accent", looking: "warning", fixed: "success", declined: "neutral" };
const control = "w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";

/** A report's own address is stored by the app, but a link is only drawn for a path inside this site. */
function isLocalPath(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\");
}

function isUpdated(row: FeedbackRow, seenAt: string | null): boolean {
  if (!row.triagedAt) return false;
  if (!seenAt) return true;
  return new Date(row.triagedAt).getTime() > new Date(seenAt).getTime();
}

export function FeedbackList({
  rows, info, status, counts, isAdmin, seenAt,
}: {
  rows: FeedbackRow[];
  info: PageInfo;
  status: FeedbackStatus | "all";
  counts: Record<FeedbackStatus, number> | null;
  isAdmin: boolean;
  seenAt: string | null;
}) {
  const t = useMessages();
  const f = t.feedback;
  const router = useRouter();
  // The time of the previous visit, kept for this visit: the refresh below brings a newer one that would clear the badges.
  const [visitSeenAt] = useState(seenAt);
  const marked = useRef(false);

  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    void markFeedbackSeen()
      .then(() => router.refresh())
      .catch(() => undefined);
  }, [router]);

  const tabs: { key: FeedbackStatus | "all"; label: string; n: number }[] = counts
    ? [
        { key: "all", label: f.all, n: FEEDBACK_STATUSES.reduce((sum, s) => sum + counts[s], 0) },
        ...FEEDBACK_STATUSES.map((s) => ({ key: s, label: f.statuses[s], n: counts[s] })),
      ]
    : [];

  return (
    <div>
      {isAdmin && (
        <nav aria-label={f.title} className="mb-4 flex flex-wrap gap-1 border-b border-line text-sm">
          {tabs.map(({ key, label, n }) => (
            <Link
              key={key}
              href={feedbackHref({ status: key, page: 1, size: info.size })}
              aria-current={key === status ? "page" : undefined}
              className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 ${key === status ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
            >
              {label}
              <span className="rounded-full bg-sunk px-2 text-xs text-ink-2">{n}</span>
            </Link>
          ))}
        </nav>
      )}
      <div className="rounded-lg border border-line bg-surface">
        {rows.length === 0 ? (
          <EmptyState icon={MessageSquareWarning} title={f.empty} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm md:min-w-[860px]">
                <thead className="bg-sunk text-left text-ink-2 max-md:sr-only">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">{f.columns.date}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{f.columns.what}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{f.columns.happened}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{f.columns.from}</th>
                    {isAdmin && <th scope="col" className="px-4 py-2 font-medium">{f.columns.reporter}</th>}
                    <th scope="col" className="px-4 py-2 font-medium">{f.columns.status}</th>
                  </tr>
                </thead>
                <tbody className="max-md:block">
                  {rows.map((r) => (
                    <FeedbackItem key={`${r.id}:${r.status}:${r.triageNote ?? ""}`} row={r} isAdmin={isAdmin} updated={!isAdmin && isUpdated(r, visitSeenAt)} />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination info={info} hrefFor={(page, size) => feedbackHref({ status, page, size })} />
          </>
        )}
      </div>
    </div>
  );
}

function FeedbackItem({ row, isAdmin, updated }: { row: FeedbackRow; isAdmin: boolean; updated: boolean }) {
  const t = useMessages();
  const f = t.feedback;
  const router = useRouter();
  const [note, setNote] = useState(row.triageNote ?? "");
  const [status, setStatus] = useState<FeedbackStatus>(row.status);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = (text: string) => <span className="mb-1 block text-xs font-medium text-ink-2 md:hidden">{text}</span>;
  const cell = "px-4 py-3 max-md:block max-md:px-3 max-md:py-1.5";

  async function save(next: FeedbackStatus, text: string) {
    if (busy) return;
    if (declineNeedsNote(next, text)) {
      setStatus(row.status);
      setProblem(f.needsReason);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await setFeedbackStatus(row.id, next, text);
      if ("error" in result) {
        setStatus(row.status);
        setProblem(result.error === "needs_reason" ? f.needsReason : f.saveFailed);
      } else {
        router.refresh();
      }
    } catch {
      setStatus(row.status);
      setProblem(f.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-line align-top first:border-t-0 max-md:block max-md:px-1 max-md:py-3">
      <td className={`whitespace-nowrap ${cell}`}>
        {label(f.columns.date)}
        <RelativeTime iso={row.createdAt} />
      </td>
      <td className={cell}>
        {label(f.columns.what)}
        <span className="block">{f.kinds[row.kind]}</span>
        <span className="mt-1 block">
          {row.impact === "blocking" ? <Badge tone="danger">{f.impacts[row.impact]}</Badge> : <span className="text-xs text-ink-2">{f.impacts[row.impact]}</span>}
        </span>
      </td>
      <td className={`${cell} md:max-w-md`}>
        {label(f.columns.happened)}
        <p className="whitespace-pre-wrap break-words">{row.description}</p>
        {row.triageNote ? <p className="mt-1 whitespace-pre-wrap break-words text-ink-2">{`↳ ${row.triageNote}`}</p> : null}
      </td>
      <td className={cell}>
        {label(f.columns.from)}
        {isLocalPath(row.pageUrl) ? (
          <a href={row.pageUrl} className="break-words text-accent underline">{row.pageLabel || row.pageUrl}</a>
        ) : (
          <span className="break-words">{row.pageLabel}</span>
        )}
        {row.screenshotUrl ? (
          <a href={row.screenshotUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block text-accent underline">{f.screenshot}</a>
        ) : null}
      </td>
      {isAdmin && (
        <td className={cell}>
          {label(f.columns.reporter)}
          <span className="break-words">{row.reporterName}</span>
        </td>
      )}
      <td className={cell}>
        {label(f.columns.status)}
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone={TONES[row.status]}>{f.statuses[row.status]}</Badge>
          {updated ? <Badge tone="accent">{f.updated}</Badge> : null}
        </span>
        {isAdmin && (
          <div className="mt-2 space-y-2 md:w-56">
            <select
              aria-label={f.columns.status}
              value={status}
              aria-busy={busy}
              onChange={(e) => {
                const next = e.target.value as FeedbackStatus;
                setStatus(next);
                void save(next, note);
              }}
              className={control}
            >
              {FEEDBACK_STATUSES.map((s) => (
                <option key={s} value={s}>{f.statuses[s]}</option>
              ))}
            </select>
            <input
              type="text"
              aria-label={f.notePlaceholder}
              placeholder={f.notePlaceholder}
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                if (note !== (row.triageNote ?? "")) void save(status, note);
              }}
              className={control}
            />
            {problem ? <p role="alert" className="text-xs text-danger">{problem}</p> : null}
          </div>
        )}
      </td>
    </tr>
  );
}
