export type HeaderTab = "sheets" | "guide" | "feedback" | "admin";

const TABS: readonly HeaderTab[] = ["sheets", "guide", "feedback", "admin"];

/** The header tab a pathname belongs to, matched on whole path segments (`/sheetsx` is not `/sheets`). */
export function activeTab(pathname: string): HeaderTab | null {
  for (const tab of TABS) {
    const base = `/${tab}`;
    if (pathname === base || pathname.startsWith(`${base}/`)) return tab;
  }
  return null;
}
