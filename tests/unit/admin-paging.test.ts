import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, pageInfo, pageRead, parsePaging, rangeOf } from "@/admin/paging";

describe("parsePaging", () => {
  it("defaults to page 1 and the default size", () => {
    expect(parsePaging({})).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE });
  });
  it("accepts only the offered sizes and positive whole pages", () => {
    expect(parsePaging({ page: "3", size: "50" })).toEqual({ page: 3, size: 50 });
    expect(parsePaging({ page: "0", size: "7" })).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE });
    expect(parsePaging({ page: "-2" })).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE });
    expect(parsePaging({ page: "2.5" })).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE });
    expect(parsePaging({ page: ["4", "9"], size: ["10"] })).toEqual({ page: 4, size: 10 });
  });
});

describe("pageInfo", () => {
  it("describes a middle page", () => {
    expect(pageInfo(42, 2, 10)).toEqual({ page: 2, pages: 5, size: 10, total: 42, from: 11, to: 20 });
  });
  it("clamps a page past the end to the last page", () => {
    expect(pageInfo(42, 9, 10)).toEqual({ page: 5, pages: 5, size: 10, total: 42, from: 41, to: 42 });
  });
  it("has one empty page when there is nothing", () => {
    expect(pageInfo(0, 3, 25)).toEqual({ page: 1, pages: 1, size: 25, total: 0, from: 0, to: 0 });
  });
});

describe("rangeOf", () => {
  it("gives the 0-based inclusive bounds for range()", () => {
    expect(rangeOf(1, 25)).toEqual({ from: 0, to: 24 });
    expect(rangeOf(3, 10)).toEqual({ from: 20, to: 29 });
  });
});

describe("pageRead", () => {
  it("reads nothing for an empty list", () => {
    expect(pageRead(0, 1, 25)).toBeNull();
    expect(pageRead(0, 99, 25)).toBeNull();
  });
  it("clamps a page past the end to the last page's rows", () => {
    expect(pageRead(30, 99, 25)).toEqual({ page: 2, from: 25, to: 49 });
  });
  it("keeps a page inside the list", () => {
    expect(pageRead(30, 1, 25)).toEqual({ page: 1, from: 0, to: 24 });
  });
});
