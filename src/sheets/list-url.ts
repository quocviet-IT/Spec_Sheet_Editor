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

export const MAX_QUERY = 200;

/** `?q=` as the page uses it: control characters (NUL included, which PostgreSQL rejects) removed, trimmed, capped. */
export function parseSheetQuery(raw: string | string[] | undefined): string {
  const text = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, MAX_QUERY);
}

/**
 * The address's `q` arrived. `pushed` holds the values this box put in the address since the last change that did not
 * come from it. A value found there is our own (possibly late) echo and must not overwrite newer typing; anything else
 * (back, forward, a link) is external and the box follows it.
 */
export function readUrlQuery(urlQ: string, pushed: readonly string[]): { adopt: boolean; pushed: string[] } {
  const at = pushed.indexOf(urlQ);
  if (at === -1) return { adopt: true, pushed: [] };
  return { adopt: false, pushed: pushed.slice(at + 1) };
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
