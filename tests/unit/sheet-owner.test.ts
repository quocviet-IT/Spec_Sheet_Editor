import { describe, expect, it } from "vitest";
import { parseSheetOwner, sheetListHref } from "@/sheets/list-url";

describe("parseSheetOwner", () => {
  it("reads all, me and a person's id, and falls back to all", () => {
    expect(parseSheetOwner(undefined)).toBe("all");
    expect(parseSheetOwner("me")).toBe("me");
    expect(parseSheetOwner("6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f")).toBe("6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f");
    expect(parseSheetOwner("6F1C2D3E-4A5B-4C6D-8E7F-9A0B1C2D3E4F")).toBe("6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f");
    expect(parseSheetOwner(["me", "x"])).toBe("me"); // an array takes its first element, as parseSheetTab does
    expect(parseSheetOwner("")).toBe("all");
    expect(parseSheetOwner("all")).toBe("all");
    expect(parseSheetOwner("ME")).toBe("all");
    expect(parseSheetOwner("6f1c2d3e")).toBe("all");
    expect(parseSheetOwner("'; drop table x")).toBe("all");
  });
});

describe("sheetListHref with an owner", () => {
  it("leaves all out and keeps me or an id", () => {
    expect(sheetListHref({ tab: "live", q: "", page: 1, size: 25 })).toBe("/sheets");
    expect(sheetListHref({ tab: "live", q: "", page: 1, size: 25, owner: "all" })).toBe("/sheets");
    expect(sheetListHref({ tab: "trash", q: "ring", page: 2, size: 25, owner: "me" })).toBe("/sheets?tab=trash&q=ring&owner=me&page=2");
  });
});
