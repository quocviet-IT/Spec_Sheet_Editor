import { describe, expect, it } from "vitest";
import { safeNext } from "@/auth/redirect";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/sheets/abc?x=1")).toBe("/sheets/abc?x=1");
    expect(safeNext("/admin")).toBe("/admin");
  });

  it("falls back for anything that could leave the site or loop", () => {
    for (const raw of [null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "sheets", "/login", "/login?next=/x", "/auth/callback"]) {
      expect(safeNext(raw)).toBe("/sheets");
    }
  });

  it("uses the given fallback", () => {
    expect(safeNext(null, "/admin")).toBe("/admin");
  });
});
