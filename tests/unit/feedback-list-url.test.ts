import { describe, expect, it } from "vitest";
import { feedbackHref } from "@/feedback/list-url";

describe("feedbackHref", () => {
  it("leaves the defaults out", () => {
    expect(feedbackHref({ status: "all", page: 1, size: 25 })).toBe("/feedback");
  });
  it("keeps a status filter", () => {
    expect(feedbackHref({ status: "fixed", page: 1, size: 25 })).toBe("/feedback?status=fixed");
  });
  it("keeps a page above 1", () => {
    expect(feedbackHref({ status: "all", page: 3, size: 25 })).toBe("/feedback?page=3");
  });
  it("leaves the size out at 25 and keeps any other", () => {
    expect(feedbackHref({ status: "new", page: 2, size: 25 })).toBe("/feedback?status=new&page=2");
    expect(feedbackHref({ status: "new", page: 2, size: 50 })).toBe("/feedback?status=new&page=2&size=50");
  });
});
