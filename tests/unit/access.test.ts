import { describe, expect, it } from "vitest";
import { decideAccess, type Profile } from "@/auth/access";

const staff: Profile = { id: "u1", email: "a@ctyhp.vn", fullName: "A", avatarUrl: null, role: "user", status: "active", passwordAccount: true };
const admin: Profile = { ...staff, id: "u2", role: "admin" };

describe("decideAccess", () => {
  it("sends signed-out visitors to sign in without an error", () => {
    expect(decideAccess(null, "signed_out", "user")).toEqual({ kind: "login" });
  });

  it("sends someone still on a one-time password to set their own, before anything else", () => {
    expect(decideAccess(null, "must_change_password", "user")).toEqual({ kind: "change_password" });
    expect(decideAccess(null, "must_change_password", "admin")).toEqual({ kind: "change_password" });
  });

  it("explains suspended and not-permitted accounts", () => {
    expect(decideAccess(null, "suspended", "user")).toEqual({ kind: "login", error: "suspended" });
    expect(decideAccess(null, "not_permitted", "user")).toEqual({ kind: "login", error: "not_permitted" });
  });

  it("sends a session without a profile back through sign-in", () => {
    expect(decideAccess(null, "ok", "user")).toEqual({ kind: "login" });
  });

  it("allows Staff into Staff pages and hides Admin pages from them", () => {
    expect(decideAccess(staff, "ok", "user")).toEqual({ kind: "allow", profile: staff });
    expect(decideAccess(staff, "ok", "admin")).toEqual({ kind: "not_found" });
  });

  it("allows Admins everywhere", () => {
    expect(decideAccess(admin, "ok", "admin")).toEqual({ kind: "allow", profile: admin });
  });

  it("treats a suspended profile as suspended even if the status call said ok", () => {
    expect(decideAccess({ ...admin, status: "suspended" }, "ok", "admin")).toEqual({ kind: "login", error: "suspended" });
  });
});
