import "server-only";
import { pageRead } from "@/admin/paging";
import { createSupabaseServer } from "@/lib/supabase/server";
import { FEEDBACK_STATUSES, type FeedbackImpact, type FeedbackKind, type FeedbackStatus } from "./model";

export type FeedbackRow = {
  id: string;
  kind: FeedbackKind;
  impact: FeedbackImpact;
  description: string;
  pageUrl: string;
  pageLabel: string;
  status: FeedbackStatus;
  triageNote: string | null;
  triagedAt: string | null;
  createdAt: string;
  /** Only an Admin gets the reporter's name; for Staff it is null. */
  reporterName: string | null;
  /** A link signed for 600 s, or null when there is no picture (or it could not be signed). */
  screenshotUrl: string | null;
};

type Row = {
  id: string; kind: FeedbackKind; impact: FeedbackImpact; description: string; page_url: string; page_label: string;
  status: FeedbackStatus; triage_note: string | null; triaged_at: string | null; created_at: string;
  screenshot_path: string | null; reporter: { full_name: string | null; email: string } | null;
};

const SIGNED_SECONDS = 600;

/**
 * One numbered page of the reports, newest first. RLS decides whose reports come back (Staff: their own; Admin: all),
 * so the same query serves both. Count first, then one range of the clamped page; thumbnails are signed for the
 * shown rows only, in one call.
 */
export async function fetchFeedbackPage(
  status: FeedbackStatus | "all", page: number, size: number, withReporter: boolean,
): Promise<{ rows: FeedbackRow[]; total: number; page: number }> {
  const supabase = await createSupabaseServer();
  let counting = supabase.from("feedback_reports").select("id", { count: "exact", head: true });
  if (status !== "all") counting = counting.eq("status", status);
  const { count, error: countError } = await counting;
  if (countError) throw countError;
  const total = count ?? 0;
  const plan = pageRead(total, page, size);
  if (!plan) return { rows: [], total, page: 1 };
  let reading = supabase
    .from("feedback_reports")
    .select(
      "id, kind, impact, description, page_url, page_label, status, triage_note, triaged_at, created_at, screenshot_path, reporter:profiles!feedback_reports_reporter_id_fkey(full_name, email)",
    );
  if (status !== "all") reading = reading.eq("status", status);
  const { data, error } = await reading
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(plan.from, plan.to);
  if (error) throw error;
  const found = (data ?? []) as unknown as Row[];
  const links = new Map<string, string>();
  const paths = found.flatMap((r) => (r.screenshot_path ? [r.screenshot_path] : []));
  if (paths.length > 0) {
    const { data: signed, error: signError } = await supabase.storage.from("feedback-screenshots").createSignedUrls(paths, SIGNED_SECONDS);
    if (signError) console.error("createSignedUrls failed:", signError.message);
    for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) links.set(s.path, s.signedUrl);
  }
  const rows: FeedbackRow[] = found.map((r) => ({
    id: r.id, kind: r.kind, impact: r.impact, description: r.description,
    pageUrl: r.page_url, pageLabel: r.page_label, status: r.status,
    triageNote: r.triage_note, triagedAt: r.triaged_at, createdAt: r.created_at,
    reporterName: withReporter ? r.reporter?.full_name || r.reporter?.email || "" : null,
    screenshotUrl: r.screenshot_path ? links.get(r.screenshot_path) ?? null : null,
  }));
  return { rows, total, page: plan.page };
}

/** How many reports are in each status (the Admin's tabs); RLS limits it to what the reader can see. */
export async function fetchFeedbackCounts(): Promise<Record<FeedbackStatus, number>> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("feedback_counts");
  if (error) throw error;
  const out = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0])) as Record<FeedbackStatus, number>;
  for (const r of (data ?? []) as { status: string; n: number | string }[]) {
    if ((FEEDBACK_STATUSES as readonly string[]).includes(r.status)) out[r.status as FeedbackStatus] = Number(r.n);
  }
  return out;
}

/** When the reader last opened the Feedback page, or null if never. Read before the page marks itself seen. */
export async function fetchFeedbackSeenAt(): Promise<string | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("feedback_seen_at");
  if (error) throw error;
  return typeof data === "string" ? data : null;
}

/** How many changes the reader has not seen yet. Never throws: the header must not fail because of a badge. */
export async function fetchFeedbackUnseen(): Promise<number> {
  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.rpc("feedback_unseen");
    if (error) return 0;
    const n = Number(data);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}
