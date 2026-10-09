import { describe, expect, it } from "vitest";
import { auditCsv, csvCell, CSV_BOM } from "@/admin/csv";

describe("csvCell", () => {
  it("quotes only when needed and doubles quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("defuses spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@x")).toBe("'@x");
  });
});

describe("auditCsv", () => {
  it("starts with a BOM and a header, uses CRLF, keeps Vietnamese text", () => {
    const csv = auditCsv([
      { occurredAt: "2026-10-09T03:00:00Z", actorEmail: "a@ctyhp.vn", action: "sheet.upload", targetType: "sheet", targetId: "id-1", detail: { name: "Nhẫn kim cương" } },
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("occurred_at,actor_email,action,target_type,target_id,detail");
    expect(lines[1]).toBe('2026-10-09T03:00:00Z,a@ctyhp.vn,sheet.upload,sheet,id-1,"{""name"":""Nhẫn kim cương""}"');
  });
});
