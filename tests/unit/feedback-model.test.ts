import { describe, expect, it } from "vitest";
import { declineNeedsNote, feedbackInput, parseFeedbackStatus } from "@/feedback/model";

const valid = {
  kind: "broken",
  impact: "slows_work",
  description: "The value did not save",
  pageUrl: "/sheets?page=2",
  pageRoute: "/sheets",
  pageLabel: "Sheets",
};

describe("feedbackInput", () => {
  it("accepts a valid report", () => {
    expect(feedbackInput.safeParse(valid).success).toBe(true);
  });
  it("trims the description before counting it", () => {
    expect(feedbackInput.safeParse({ ...valid, description: "  abcd  " }).success).toBe(false);
    expect(feedbackInput.parse({ ...valid, description: "  abcde  " }).description).toBe("abcde");
  });
  it("rejects more than 4000 characters", () => {
    expect(feedbackInput.safeParse({ ...valid, description: "a".repeat(4000) }).success).toBe(true);
    expect(feedbackInput.safeParse({ ...valid, description: "a".repeat(4001) }).success).toBe(false);
  });
  it("rejects an unknown kind or impact", () => {
    expect(feedbackInput.safeParse({ ...valid, kind: "other" }).success).toBe(false);
    expect(feedbackInput.safeParse({ ...valid, impact: "huge" }).success).toBe(false);
  });
  it("rejects a pageUrl without a leading slash", () => {
    expect(feedbackInput.safeParse({ ...valid, pageUrl: "https://example.com/" }).success).toBe(false);
    expect(feedbackInput.safeParse({ ...valid, pageUrl: "/" + "a".repeat(500) }).success).toBe(false);
  });
});

describe("parseFeedbackStatus", () => {
  it("reads a status, the first of several, and falls back to all", () => {
    expect(parseFeedbackStatus("looking")).toBe("looking");
    expect(parseFeedbackStatus(["fixed", "x"])).toBe("fixed");
    expect(parseFeedbackStatus("x")).toBe("all");
    expect(parseFeedbackStatus(undefined)).toBe("all");
  });
});

describe("declineNeedsNote", () => {
  it("needs a note only to decline", () => {
    expect(declineNeedsNote("declined", "  ")).toBe(true);
    expect(declineNeedsNote("declined", "dup")).toBe(false);
    expect(declineNeedsNote("fixed", "")).toBe(false);
  });
});
