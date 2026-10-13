import type { Messages } from "@/messages";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SHEET_PATH = new RegExp(`^/sheets/${UUID}/?$`, "i");

/** The route pattern of a path: a sheet's id is not part of it. */
export function pageRouteOf(pathname: string): string {
  return SHEET_PATH.test(pathname) ? "/sheets/[id]" : pathname;
}

export const PAGE_LABEL_MAX = 200;

/** Whole characters from the start while they fit in `max` UTF-16 units (what the schema counts; never more than the database's characters). */
function head(text: string, max: number): string {
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/** At most `max` characters; a longer text is cut and ends with an ellipsis. */
export function clipLabel(text: string, max: number = PAGE_LABEL_MAX): string {
  return text.length <= max ? text : head(text, max - 1) + "…";
}

/** What the page is called in the menu, in the reader's language; an unknown path stays as it is. */
export function pageLabelOf(pathname: string, t: Messages, sheetName?: string | null): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/sheets") return t.common.sheets;
  if (SHEET_PATH.test(path)) {
    const name = sheetName?.trim();
    if (!name) return t.common.sheets;
    const room = PAGE_LABEL_MAX - t.feedback.editorPage.replace("{name}", "").length;
    return clipLabel(t.feedback.editorPage.replace("{name}", clipLabel(name, Math.max(room, 1))));
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
  return clipLabel(pathname);
}
