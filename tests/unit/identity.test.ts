import { describe, expect, it } from "vitest";
import { identityFromClaims } from "@/auth/identity";

describe("identityFromClaims", () => {
  it("reads the id and email from verified claims", () => {
    expect(identityFromClaims({ sub: "u1", email: "a@ctyhp.vn" })).toEqual({ id: "u1", email: "a@ctyhp.vn" });
  });

  it("keeps the id when there is no usable email", () => {
    expect(identityFromClaims({ sub: "u1" })).toEqual({ id: "u1", email: null });
    expect(identityFromClaims({ sub: "u1", email: "" })).toEqual({ id: "u1", email: null });
    expect(identityFromClaims({ sub: "u1", email: 42 })).toEqual({ id: "u1", email: null });
  });

  it("has no identity without a string subject", () => {
    expect(identityFromClaims(null)).toBeNull();
    expect(identityFromClaims(undefined)).toBeNull();
    expect(identityFromClaims({})).toBeNull();
    expect(identityFromClaims({ sub: "" })).toBeNull();
    expect(identityFromClaims({ sub: 7 })).toBeNull();
  });
});
