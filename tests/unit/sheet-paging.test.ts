import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE } from "@/admin/paging";
import { nameContainsPattern, parseSheetQuery, parseSheetTab, readUrlQuery, sheetListHref } from "@/sheets/list-url";

describe("nameContainsPattern", () => {
  const matches = (query: string, name: string) => new RegExp(nameContainsPattern(query), "i").test(name);

  it("matches the text anywhere in the name, ignoring case", () => {
    expect(matches("sheet", "Winter SHEET 12")).toBe(true);
    expect(matches("sheet", "Winter 12")).toBe(false);
  });

  it("makes % _ * and , mean themselves", () => {
    expect(matches("50%", "Rate 50% off")).toBe(true);
    expect(matches("50%", "Rate 500 off")).toBe(false);
    expect(matches("a_c", "a_c")).toBe(true);
    expect(matches("a_c", "abc")).toBe(false);
    expect(matches("a*c", "a*c")).toBe(true);
    expect(matches("a*c", "abbc")).toBe(false);
    expect(matches("a,b", "x a,b y")).toBe(true);
    expect(matches("a,b", "ab")).toBe(false);
  });

  it("makes backslash and regex characters mean themselves", () => {
    expect(matches("a\\b", "a\\b")).toBe(true);
    expect(matches("a\\b", "ab")).toBe(false);
    for (const text of [".", "(x)", "[x]", "{2}", "^a", "a$", "a|b", "a+", "a?", "-"]) {
      expect(matches(text, `pre ${text} post`), text).toBe(true);
    }
    expect(matches("a.c", "abc")).toBe(false);
    expect(matches("a|b", "a")).toBe(false);
  });

  it("trims the text", () => {
    expect(nameContainsPattern("  ab  ")).toBe("ab");
  });
});

describe("parseSheetTab", () => {
  it("accepts live and trash, and falls back to live", () => {
    expect(parseSheetTab("trash")).toBe("trash");
    expect(parseSheetTab("live")).toBe("live");
    expect(parseSheetTab("x")).toBe("live");
    expect(parseSheetTab(undefined)).toBe("live");
    expect(parseSheetTab(["trash", "live"])).toBe("trash");
  });
});

describe("sheetListHref", () => {
  it("is plain /sheets for the live tab, no search, page 1 and the default size", () => {
    expect(sheetListHref({ tab: "live", q: "", page: 1, size: DEFAULT_PAGE_SIZE })).toBe("/sheets");
  });

  it("keeps the tab, search, page and size when they are not the defaults", () => {
    expect(sheetListHref({ tab: "trash", q: "a b", page: 3, size: 10 })).toBe("/sheets?tab=trash&q=a+b&page=3&size=10");
  });

  it("encodes special characters in the search", () => {
    const href = sheetListHref({ tab: "live", q: "a&b=c%", page: 1, size: DEFAULT_PAGE_SIZE });
    expect(new URL(href, "http://x").searchParams.get("q")).toBe("a&b=c%");
    expect(href).not.toContain("&b=");
  });

  it("changing the tab or the search resets the page, by passing page 1", () => {
    expect(sheetListHref({ tab: "trash", q: "x", page: 1, size: 25 })).toBe("/sheets?tab=trash&q=x");
  });
});

describe("parseSheetQuery", () => {
  it("removes control characters including NUL, then trims", () => {
    expect(parseSheetQuery("  a\u0000b\u0007c\n ")).toBe("abc");
    expect(parseSheetQuery(["x\u0000", "y"])).toBe("x");
    expect(parseSheetQuery(undefined)).toBe("");
  });

  it("caps the length", () => {
    expect(parseSheetQuery("a".repeat(500))).toHaveLength(200);
  });
});

describe("readUrlQuery", () => {
  it("ignores a late echo of our own push and keeps the newer ones", () => {
    const first = readUrlQuery("ab", ["", "ab", "abc"]);
    expect(first).toEqual({ adopt: false, pushed: ["abc"] });
    expect(readUrlQuery("abc", first.pushed)).toEqual({ adopt: false, pushed: [] });
  });

  it("adopts an address change we did not push and forgets older pushes", () => {
    expect(readUrlQuery("zzz", ["", "ab"])).toEqual({ adopt: true, pushed: [] });
  });
});
