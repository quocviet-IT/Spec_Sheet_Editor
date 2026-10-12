import { describe, expect, it } from "vitest";
import { AUDIT_GROUPS } from "@/admin/audit-filter";
import { AUDIT_FALLBACK_ICON, AUDIT_ICON_KEYS, auditActionLabel, auditIconKey } from "@/admin/audit-icons";
import { en, vi } from "@/messages";

describe("auditIconKey", () => {
  it("gives every group except sheets an icon of its own from the prefix alone", () => {
    for (const group of AUDIT_GROUPS.filter((g) => g !== "all" && g !== "sheet")) {
      const key = auditIconKey(`${group}.anything`);
      expect(AUDIT_ICON_KEYS).toContain(key);
      expect(key, group).not.toBe(AUDIT_FALLBACK_ICON);
    }
  });
  it("maps the sheet actions one by one", () => {
    expect(auditIconKey("sheet.upload")).toBe("upload");
    expect(auditIconKey("sheet.save")).toBe("save");
    expect(auditIconKey("sheet.export_png")).toBe("export");
    expect(auditIconKey("sheet.export_pdf")).toBe("export");
    expect(auditIconKey("sheet.trash")).toBe("trash");
    expect(auditIconKey("sheet.restore")).toBe("restore");
    expect(auditIconKey("sheet.purge")).toBe("purge");
    expect(auditIconKey("auth.login")).toBe("signin");
  });
  it("falls back for unknown actions", () => {
    expect(auditIconKey("sheet.detect")).toBe(AUDIT_FALLBACK_ICON);
    expect(auditIconKey("nothing.here")).toBe(AUDIT_FALLBACK_ICON);
    expect(auditIconKey("")).toBe(AUDIT_FALLBACK_ICON);
    expect(auditIconKey("constructor.x")).toBe(AUDIT_FALLBACK_ICON);
  });
});

describe("auditActionLabel", () => {
  const KNOWN = ["access.add", "access.remove", "auth.denied", "auth.login", "maintenance.orphan_cleanup", "maintenance.test_accounts_removed", "settings.update", "sheet.detect", "sheet.export_pdf", "sheet.export_png", "sheet.purge", "sheet.restore", "sheet.save", "sheet.trash", "sheet.upload", "user.create", "user.password_changed", "user.password_reset", "user.role_change", "user.suspend", "user.unsuspend"];
  it("has a label for every known action in both languages", () => {
    for (const dict of [vi, en]) for (const action of KNOWN) expect(auditActionLabel(dict.admin.audit.actions, action), action).toBeTruthy();
  });
  it("returns null for an unknown action, including inherited names", () => {
    expect(auditActionLabel(en.admin.audit.actions, "sheet.unknown")).toBeNull();
    expect(auditActionLabel(en.admin.audit.actions, "constructor")).toBeNull();
  });
});
