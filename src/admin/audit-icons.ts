/** Which icon an audit entry's action gets. Pure, so it can be tested; the page maps each key to a lucide component. */
export const AUDIT_ICON_KEYS = ["upload", "save", "export", "trash", "restore", "purge", "signin", "user", "access", "settings", "maintenance", "activity"] as const;
export type AuditIconKey = (typeof AUDIT_ICON_KEYS)[number];

const EXACT: Record<string, AuditIconKey> = {
  "sheet.upload": "upload",
  "sheet.save": "save",
  "sheet.export_png": "export",
  "sheet.export_pdf": "export",
  "sheet.trash": "trash",
  "sheet.restore": "restore",
  "sheet.purge": "purge",
};

const BY_GROUP: Record<string, AuditIconKey> = {
  auth: "signin",
  user: "user",
  access: "access",
  settings: "settings",
  maintenance: "maintenance",
};

export const AUDIT_FALLBACK_ICON: AuditIconKey = "activity";

export function auditIconKey(action: string): AuditIconKey {
  if (Object.hasOwn(EXACT, action)) return EXACT[action];
  const group = action.split(".")[0];
  return Object.hasOwn(BY_GROUP, group) ? BY_GROUP[group] : AUDIT_FALLBACK_ICON;
}
