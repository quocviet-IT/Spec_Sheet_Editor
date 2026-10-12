import { describe, expect, it } from "vitest";
import { relativeTime } from "@/lib/relative-time";

const now = new Date("2026-10-12T10:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("says now under a minute, in Intl's own words", () => {
    const now0 = (loc: string) => new Intl.RelativeTimeFormat(loc, { numeric: "auto" }).format(0, "second");
    expect(relativeTime(ago(20_000), now, "en")).toBe(now0("en-GB"));
    expect(relativeTime(ago(20_000), now, "vi")).toBe(now0("vi-VN"));
  });
  it("counts minutes, hours and days", () => {
    expect(relativeTime(ago(5 * MIN), now, "en")).toBe("5 minutes ago");
    expect(relativeTime(ago(3 * HOUR), now, "en")).toBe("3 hours ago");
    expect(relativeTime(ago(2 * DAY), now, "en")).toBe("2 days ago");
    expect(relativeTime(ago(2 * DAY), now, "vi")).toBe("2 ngày trước");
  });
  it("shows the date from 30 days on, in Vietnam time", () => {
    expect(relativeTime("2026-08-01T20:00:00Z", now, "en")).toBe("02/08/2026");
  });
  it("returns the input for a value that is not a date", () => {
    expect(relativeTime("not a date", now, "en")).toBe("not a date");
  });
});
