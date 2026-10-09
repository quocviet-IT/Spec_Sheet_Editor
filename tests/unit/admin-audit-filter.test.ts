import { describe, expect, it } from "vitest";
import { auditRange, filterQuery, groupPrefix, parseAuditFilter } from "@/admin/audit-filter";

const NOW = new Date("2026-10-09T03:00:00Z"); // 10:00 in Ho Chi Minh City
const UUID = "8f0f8a52-4b6e-4f5e-9d55-7d1f3c2a9b10";

describe("parseAuditFilter", () => {
  it("defaults to the last 7 days and every action", () => {
    expect(parseAuditFilter({}, NOW)).toEqual({ from: "2026-10-03", to: "2026-10-09", actor: null, group: "all", target: null });
  });

  it("takes valid values and drops invalid ones", () => {
    expect(parseAuditFilter({ from: "2026-10-01", to: "2026-10-05", actor: UUID, group: "sheet", target: UUID }, NOW))
      .toEqual({ from: "2026-10-01", to: "2026-10-05", actor: UUID, group: "sheet", target: UUID });
    expect(parseAuditFilter({ from: "yesterday", actor: "me", group: "x", target: "1; drop" }, NOW))
      .toEqual({ from: "2026-10-03", to: "2026-10-09", actor: null, group: "all", target: null });
  });

  it("swaps a reversed range", () => {
    expect(parseAuditFilter({ from: "2026-10-08", to: "2026-10-02" }, NOW)).toMatchObject({ from: "2026-10-02", to: "2026-10-08" });
  });

  it("uses the Ho Chi Minh City day for today", () => {
    expect(parseAuditFilter({}, new Date("2026-10-09T18:30:00Z")).to).toBe("2026-10-10"); // 01:30 next day there
  });
});

describe("auditRange and groups", () => {
  it("covers whole local days", () => {
    expect(auditRange({ from: "2026-10-03", to: "2026-10-09", actor: null, group: "all", target: null }))
      .toEqual({ fromIso: "2026-10-03T00:00:00+07:00", toIsoExclusive: "2026-10-10T00:00:00+07:00" });
  });

  it("maps groups to action prefixes", () => {
    expect(groupPrefix("all")).toBeNull();
    expect(groupPrefix("sheet")).toBe("sheet.");
    expect(groupPrefix("maintenance")).toBe("maintenance.");
  });

  it("writes the filter back as a query string", () => {
    expect(filterQuery({ from: "2026-10-03", to: "2026-10-09", actor: UUID, group: "user", target: null }))
      .toBe(`from=2026-10-03&to=2026-10-09&actor=${UUID}&group=user`);
  });
});
