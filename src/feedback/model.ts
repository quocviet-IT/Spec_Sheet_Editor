import { z } from "zod";

export const FEEDBACK_KINDS = ["broken", "misread", "suggestion"] as const;
export const FEEDBACK_IMPACTS = ["blocking", "slows_work", "minor"] as const;
export const FEEDBACK_STATUSES = ["new", "looking", "fixed", "declined"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackImpact = (typeof FEEDBACK_IMPACTS)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const DESCRIPTION_MIN = 5;
export const DESCRIPTION_MAX = 4000;
export const NOTE_MAX = 2000;
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

export const feedbackInput = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  impact: z.enum(FEEDBACK_IMPACTS),
  description: z.string().trim().min(DESCRIPTION_MIN).max(DESCRIPTION_MAX),
  pageUrl: z.string().max(500).startsWith("/"),
  pageRoute: z.string().max(200),
  pageLabel: z.string().max(200),
});
export type FeedbackInput = z.infer<typeof feedbackInput>;

/** The status filter from a query string; anything that is not a status means every report. */
export function parseFeedbackStatus(raw: string | string[] | undefined): FeedbackStatus | "all" {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (FEEDBACK_STATUSES as readonly string[]).includes(value ?? "") ? (value as FeedbackStatus) : "all";
}

/** Declining a report needs a reason the reporter can read. */
export function declineNeedsNote(status: FeedbackStatus, note: string): boolean {
  return status === "declined" && note.trim() === "";
}
