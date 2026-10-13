import type { Messages } from "@/messages";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SHEET_PATH = new RegExp(`^/sheets/${UUID}/?$`, "i");

/** The route pattern of a path: a sheet's id is not part of it. */
export function pageRouteOf(pathname: string): string {
  return SHEET_PATH.test(pathname) ? "/sheets/[id]" : pathname;
}

/** What the page is called in the menu, in the reader's language; an unknown path stays as it is. */
export function pageLabelOf(pathname: string, t: Messages, sheetName?: string | null): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/sheets") return t.common.sheets;
  if (SHEET_PATH.test(path)) {
    const name = sheetName?.trim();
    return name ? t.feedback.editorPage.replace("{name}", name) : t.common.sheets;
  }
  if (path === "/guide") return t.common.guide;
  if (path === "/feedback") return t.common.feedback;
  if (path === "/account/password") return t.account.password.title;
  if (path === "/admin") return t.common.admin;
  const area = path.match(/^\/admin\/(users|access|audit|trash)(?:\/|$)/)?.[1];
  if (area) {
    const name = area === "trash" ? t.admin.areas.cleanup : t.admin.areas[area as "users" | "access" | "audit"];
    return `${t.common.admin}: ${name}`;
  }
  return pathname;
}
