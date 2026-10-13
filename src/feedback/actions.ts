"use server";

import { z } from "zod";
import { requireAdmin, requireUser } from "@/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { FEEDBACK_STATUSES, NOTE_MAX, feedbackInput, type FeedbackStatus } from "./model";
import { clipLabel } from "./page-label";

const idSchema = z.uuid();
const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/** Files a report as the signed-in person. The row is theirs by RLS; nothing else about them is taken from the browser. */
export async function fileFeedback(input: unknown): Promise<{ ok: true; id: string } | { error: "invalid" | "unknown" }> {
  const me = await requireUser("/feedback");
  // A label that is too long is cut here rather than refused, so a long sheet name never blocks a report.
  const raw =
    input && typeof input === "object" && typeof (input as { pageLabel?: unknown }).pageLabel === "string"
      ? { ...input, pageLabel: clipLabel((input as { pageLabel: string }).pageLabel) }
      : input;
  const parsed = feedbackInput.safeParse(raw);
  if (!parsed.success) return { error: "invalid" };
  try {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase
      .from("feedback_reports")
      .insert({
        kind: parsed.data.kind,
        impact: parsed.data.impact,
        description: parsed.data.description,
        page_url: parsed.data.pageUrl,
        page_route: parsed.data.pageRoute,
        page_label: parsed.data.pageLabel,
        reporter_id: me.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) {
      console.error("fileFeedback failed:", error?.message);
      return { error: "unknown" };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    console.error("fileFeedback failed:", e instanceof Error ? e.message : "unknown");
    return { error: "unknown" };
  }
}

/** Links an uploaded picture to the report. The path must be `<report id>/<uuid v4>.png` with the same id. */
export async function attachFeedbackScreenshot(reportId: string, path: string): Promise<{ ok: true } | { error: "invalid" | "unknown" }> {
  await requireUser("/feedback");
  const id = idSchema.safeParse(reportId);
  if (!id.success || typeof path !== "string") return { error: "invalid" };
  if (!new RegExp(`^${id.data}/${UUID_V4}\\.png$`, "i").test(path)) return { error: "invalid" };
  try {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("attach_feedback_screenshot", { p_report_id: id.data, p_path: path });
    if (error) {
      console.error("attachFeedbackScreenshot failed:", error.message);
      return { error: "unknown" };
    }
    return { ok: true };
  } catch (e) {
    console.error("attachFeedbackScreenshot failed:", e instanceof Error ? e.message : "unknown");
    return { error: "unknown" };
  }
}

function has(message: string, word: string): boolean {
  return new RegExp(`(?<![a-z_])${word}(?![a-z_])`).test(message);
}

type SetStatusError = "invalid" | "forbidden" | "needs_reason" | "unknown";

/**
 * Moves a report to a status for the reporter to read about. An Admin only; the database checks that too. A null note
 * keeps the one already there, an empty one clears it, and declining needs a reason.
 */
export async function setFeedbackStatus(id: string, status: FeedbackStatus, note: string | null): Promise<{ ok: true } | { error: SetStatusError }> {
  await requireAdmin("/feedback");
  const uuid = idSchema.safeParse(id);
  if (!uuid.success || !(FEEDBACK_STATUSES as readonly string[]).includes(status)) return { error: "invalid" };
  if (note !== null && (typeof note !== "string" || note.length > NOTE_MAX)) return { error: "invalid" };
  try {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("set_feedback_status", { p_id: uuid.data, p_status: status, p_note: note });
    if (!error) return { ok: true };
    if (has(error.message, "forbidden")) return { error: "forbidden" };
    if (has(error.message, "decline_needs_reason")) return { error: "needs_reason" };
    if (has(error.message, "invalid_status") || has(error.message, "note_too_long") || has(error.message, "not_found")) return { error: "invalid" };
    console.error("setFeedbackStatus failed:", error.message);
    return { error: "unknown" };
  } catch (e) {
    console.error("setFeedbackStatus failed:", e instanceof Error ? e.message : "unknown");
    return { error: "unknown" };
  }
}

/** Marks the reader's Feedback page as seen now, which clears the count in the header. Failure is not shown to anyone. */
export async function markFeedbackSeen(): Promise<void> {
  await requireUser("/feedback");
  try {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("mark_feedback_seen");
    if (error) console.error("markFeedbackSeen failed:", error.message);
  } catch (e) {
    console.error("markFeedbackSeen failed:", e instanceof Error ? e.message : "unknown");
  }
}
