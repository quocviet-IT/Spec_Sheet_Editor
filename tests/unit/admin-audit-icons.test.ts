import { describe, expect, it } from "vitest";
import { AUDIT_GROUPS } from "@/admin/audit-filter";
import { AUDIT_FALLBACK_ICON, AUDIT_ICON_KEYS, auditIconKey } from "@/admin/audit-icons";

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
