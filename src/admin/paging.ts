/** Page sizes offered in every Admin table, and the default. */
export const PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 25;

export type PageInfo = { page: number; pages: number; size: number; total: number; from: number; to: number };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** `?page=` and `?size=` from the URL; anything unexpected falls back to page 1 and the default size. */
export function parsePaging(params: Record<string, string | string[] | undefined>): { page: number; size: number } {
  const rawPage = first(params.page);
  const rawSize = Number(first(params.size));
  const page = rawPage && /^[1-9]\d{0,5}$/.test(rawPage) ? Number(rawPage) : 1;
  const size = (PAGE_SIZES as readonly number[]).includes(rawSize) ? rawSize : DEFAULT_PAGE_SIZE;
  return { page, size };
}

/** Which rows a page shows, with the page clamped to the last one; `from` and `to` are 1-based for display. */
export function pageInfo(total: number, page: number, size: number): PageInfo {
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pages);
  if (total === 0) return { page: 1, pages: 1, size, total: 0, from: 0, to: 0 };
  const from = (current - 1) * size + 1;
  return { page: current, pages, size, total, from, to: Math.min(total, current * size) };
}

/** The 0-based inclusive bounds for PostgREST's range(). */
export function rangeOf(page: number, size: number): { from: number; to: number } {
  const from = (Math.max(1, page) - 1) * size;
  return { from, to: from + size - 1 };
}

/** What to read for a page once the total is known: the clamped page and its range, or null when there is nothing to read. */
export function pageRead(total: number, page: number, size: number): { page: number; from: number; to: number } | null {
  if (total <= 0) return null;
  const current = pageInfo(total, page, size).page;
  return { page: current, ...rangeOf(current, size) };
}
