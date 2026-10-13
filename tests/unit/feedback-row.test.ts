import { describe, expect, it } from "vitest";
import { isLocalPath, isUpdated } from "@/feedback/row";

describe("isLocalPath", () => {
  it("accepts paths inside this site", () => {
    expect(isLocalPath("/sheets")).toBe(true);
    expect(isLocalPath("/sheets/abc?x=1")).toBe(true);
  });
  it("refuses anything that could leave the site", () => {
    expect(isLocalPath("//evil.example")).toBe(false);
    expect(isLocalPath("/\\evil")).toBe(false);
    expect(isLocalPath("/a\\b")).toBe(false);
    expect(isLocalPath("/\t/evil.example")).toBe(false);
    expect(isLocalPath("/\n/evil.example")).toBe(false);
    expect(isLocalPath("javascript:alert(1)")).toBe(false);
    expect(isLocalPath("")).toBe(false);
  });
});

describe("isUpdated", () => {
  const seen = "2026-10-10T10:00:00Z";
  it("is false when the report was never triaged", () => {
    expect(isUpdated(null, seen)).toBe(false);
    expect(isUpdated(null, null)).toBe(false);
  });
  it("is true on a first visit when the report was triaged", () => {
    expect(isUpdated("2026-10-01T00:00:00Z", null)).toBe(true);
  });
  it("is true only when triaged after the last visit", () => {
    expect(isUpdated("2026-10-11T00:00:00Z", seen)).toBe(true);
    expect(isUpdated("2026-10-09T00:00:00Z", seen)).toBe(false);
    expect(isUpdated(seen, seen)).toBe(false);
  });
});
