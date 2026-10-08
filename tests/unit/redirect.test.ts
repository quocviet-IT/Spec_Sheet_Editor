import { describe, expect, it } from "vitest";
import { afterPassword, safeNext } from "@/auth/redirect";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/sheets/abc?x=1")).toBe("/sheets/abc?x=1");
    expect(safeNext("/admin")).toBe("/admin");
  });

  it("keeps a same-site path whose query or hash mentions another site", () => {
    expect(safeNext("/sheets?ref=https://evil.example")).toBe("/sheets?ref=https://evil.example");
    expect(safeNext("/sheets#//evil.example")).toBe("/sheets#//evil.example");
  });

  it("falls back for anything that could leave the site or loop", () => {
    for (const raw of [
      null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "sheets",
      "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/%09/x\u0000",
      "/login", "/login/", "/login#x", "/login?next=/x", "/auth", "/auth/callback",
    ]) {
      expect(safeNext(raw)).toBe("/sheets");
    }
  });

  it("uses the given fallback", () => {
    expect(safeNext(null, "/admin")).toBe("/admin");
  });
});

describe("afterPassword", () => {
  it("never points back at the password page", () => {
    expect(afterPassword("/account/password")).toBe("/sheets");
    expect(afterPassword("/account/password?next=/x")).toBe("/sheets");
  });

  it("keeps other paths", () => {
    expect(afterPassword("/sheets/123")).toBe("/sheets/123");
  });
});
