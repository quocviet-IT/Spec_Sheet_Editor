import { DEFAULT_PAGE_SIZE } from "@/admin/paging";
import type { FeedbackStatus } from "./model";

/** The address of one page of the Feedback list; parameters that equal their defaults are left out. */
export function feedbackHref({ status, page, size }: { status: FeedbackStatus | "all"; page: number; size: number }): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (page > 1) params.set("page", String(page));
  if (size !== DEFAULT_PAGE_SIZE) params.set("size", String(size));
  const qs = params.toString();
  return qs ? `/feedback?${qs}` : "/feedback";
}
