import type { PageInfo } from "@/admin/paging";
import { PaginationView, type PaginationLinks } from "./pagination-view";

type LinkMode = { info: PageInfo; hrefFor: (page: number, size: number) => string };
type ClientMode = { info: PageInfo; onChange: (page: number, size: number) => void };

/**
 * "Showing 1-25 of N", a rows-per-page choice, previous and next, and "Page x of y".
 *
 * Two modes. Link mode (server pages): previous and next are links, and the size select sits in a small GET form
 * that keeps the other query parameters, so it works without JavaScript (a Go button shows only then). Client mode
 * (lists paged in the browser): previous, next and the select call onChange(page, size); a new size returns to page 1.
 * This wrapper has no hooks and no directive, so a server page can pass hrefFor (a function cannot cross into a
 * client component): it turns hrefFor into plain strings here, and PaginationView, a client component, renders them.
 * Previous and next are disabled at the ends, the one allowed use of disabled.
 */
export function Pagination(props: LinkMode | ClientMode) {
  if (!("hrefFor" in props)) return <PaginationView info={props.info} onChange={props.onChange} />;
  const { info, hrefFor } = props;
  const current = new URL(hrefFor(1, info.size), "http://local");
  const hidden: [string, string][] = [];
  current.searchParams.forEach((value, name) => {
    if (name !== "page" && name !== "size") hidden.push([name, value]);
  });
  const links: PaginationLinks = {
    action: current.pathname,
    hidden,
    previous: hrefFor(Math.max(1, info.page - 1), info.size),
    next: hrefFor(Math.min(info.pages, info.page + 1), info.size),
  };
  return <PaginationView info={info} links={links} />;
}
