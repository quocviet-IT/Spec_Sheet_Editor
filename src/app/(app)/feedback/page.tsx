import { MessageSquareWarning } from "lucide-react";
import { pageInfo, parsePaging } from "@/admin/paging";
import { requireUser } from "@/auth/session";
import { parseFeedbackStatus, type FeedbackStatus } from "@/feedback/model";
import { fetchFeedbackCounts, fetchFeedbackPage, fetchFeedbackSeenAt } from "@/feedback/queries";
import { getMessages } from "@/messages/server";
import { FeedbackList } from "./feedback-list";

async function load(status: FeedbackStatus | "all", page: number, size: number, isAdmin: boolean) {
  // The seen time is read before this page marks itself seen, so the "Updated" badges mean what changed since last time.
  const seenAt = await fetchFeedbackSeenAt();
  const [found, counts] = await Promise.all([
    fetchFeedbackPage(status, page, size, isAdmin),
    isAdmin ? fetchFeedbackCounts() : Promise.resolve(null),
  ]);
  return { seenAt, found, counts };
}

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser("/feedback");
  const isAdmin = me.role === "admin";
  const params = await searchParams;
  const t = await getMessages();
  const f = t.feedback;
  // Staff see their own reports in one list, so they ignore the filter; RLS limits the rows to theirs.
  const status = isAdmin ? parseFeedbackStatus(params.status) : "all";
  const { page, size } = parsePaging(params);
  let data: Awaited<ReturnType<typeof load>> | null = null;
  try {
    data = await load(status, page, size, isAdmin);
  } catch (e) {
    console.error("Feedback page failed:", e instanceof Error ? e.message : "unknown");
  }
  const body = data ? (
    <FeedbackList
      rows={data.found.rows}
      info={pageInfo(data.found.total, data.found.page, size)}
      status={status}
      counts={data.counts}
      isAdmin={isAdmin}
      seenAt={data.seenAt}
    />
  ) : (
    <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm">
      {f.loadFailed}
    </p>
  );
  return (
    <section>
      <header className="mb-6 space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
          <MessageSquareWarning size={20} aria-hidden="true" className="shrink-0 text-accent" />
          {f.title}
        </h1>
        <p className="text-sm text-ink-2">{isAdmin ? f.leadAdmin : f.leadStaff}</p>
      </header>
      {body}
    </section>
  );
}
