import { describe, expect, it } from "vitest";
import { pageLabelOf, pageRouteOf } from "@/feedback/page-label";
import { en, vi } from "@/messages";

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

describe("pageRouteOf", () => {
  it("maps a sheet to its route pattern and keeps other paths", () => {
    expect(pageRouteOf(`/sheets/${ID}`)).toBe("/sheets/[id]");
    expect(pageRouteOf("/sheets")).toBe("/sheets");
    expect(pageRouteOf("/admin/audit")).toBe("/admin/audit");
  });
});

describe("pageLabelOf", () => {
  it("names the pages in the reader's language", () => {
    expect(pageLabelOf("/sheets", en)).toBe(en.common.sheets);
    expect(pageLabelOf("/sheets", vi)).toBe(vi.common.sheets);
    expect(pageLabelOf("/guide", en)).toBe(en.common.guide);
    expect(pageLabelOf("/account/password", en)).toBe(en.account.password.title);
  });
  it("names the editor with the sheet", () => {
    expect(pageLabelOf(`/sheets/${ID}`, en, "Ring 12")).toBe("the editor, sheet Ring 12");
  });
  it("names an Admin area", () => {
    expect(pageLabelOf("/admin/audit", en)).toBe("Admin: Audit log");
    expect(pageLabelOf("/admin/trash", en)).toContain(en.admin.areas.cleanup);
  });
  it("returns an unknown path as it is", () => {
    expect(pageLabelOf("/somewhere/else", en)).toBe("/somewhere/else");
  });
});
