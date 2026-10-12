import { DEFAULT_PAGE_SIZE } from "@/admin/paging";
import type { SheetTab } from "./types";

/**
 * The text of a "name contains" search as a PostgreSQL regular expression for PostgREST's `imatch` (case-insensitive).
 * `ilike` is not used: PostgREST turns every `*` in an `ilike` value into `%`, so a literal `*` could not be searched.
 * Every character with a meaning in a regular expression, `%` `_` and `,` included, is matched as itself.
 */
export function nameContainsPattern(query: string): string {
  return query.trim().replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** `?tab=`: `trash` or, for anything else, `live`. */
export function parseSheetTab(raw: string | string[] | undefined): SheetTab {
  return first(raw) === "trash" ? "trash" : "live";
}

/** The address of one page of the sheet list; parameters that equal their defaults are left out. */
export function sheetListHref({ tab, q, page, size }: { tab: SheetTab; q: string; page: number; size: number }): string {
  const params = new URLSearchParams();
  if (tab === "trash") params.set("tab", "trash");
  if (q.trim()) params.set("q", q.trim());
  if (page > 1) params.set("page", String(page));
  if (size !== DEFAULT_PAGE_SIZE) params.set("size", String(size));
  const qs = params.toString();
  return qs ? `/sheets?${qs}` : "/sheets";
}
