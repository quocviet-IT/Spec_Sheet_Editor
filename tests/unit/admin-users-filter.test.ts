import { describe, expect, it } from "vitest";
import { filterUsers, fold } from "@/admin/users-filter";

const u = (email: string, fullName: string | null, role: "user" | "admin", status: "active" | "suspended", mustChangePassword = false) =>
  ({ email, fullName, role, status, passwordAccount: true, mustChangePassword });
const rows = [
  u("admin@ctyhp.vn", "Quản trị viên", "admin", "active"),
  u("intern1@ctyhp.vn", "Tạ Quốc Việt", "user", "active"),
  u("sx01@ctyhp.vn", "TLKT 1", "user", "active", true),
  u("old@ctyhp.vn", "Đặng Cũ", "user", "suspended"),
];
const all = { query: "", role: "all" as const, status: "all" as const };

describe("filterUsers", () => {
  it("keeps everyone with no filter", () => {
    expect(filterUsers(rows, all)).toHaveLength(4);
  });
  it("searches name and email without accents", () => {
    expect(filterUsers(rows, { ...all, query: "quoc viet" }).map((r) => r.email)).toEqual(["intern1@ctyhp.vn"]);
    expect(filterUsers(rows, { ...all, query: "dang" }).map((r) => r.email)).toEqual(["old@ctyhp.vn"]);
    expect(filterUsers(rows, { ...all, query: "SX01" }).map((r) => r.email)).toEqual(["sx01@ctyhp.vn"]);
  });
  it("filters by role and by status, waiting meaning a first password not yet set", () => {
    expect(filterUsers(rows, { ...all, role: "admin" }).map((r) => r.email)).toEqual(["admin@ctyhp.vn"]);
    expect(filterUsers(rows, { ...all, status: "suspended" }).map((r) => r.email)).toEqual(["old@ctyhp.vn"]);
    expect(filterUsers(rows, { ...all, status: "waiting" }).map((r) => r.email)).toEqual(["sx01@ctyhp.vn"]);
    expect(filterUsers(rows, { ...all, status: "active" }).map((r) => r.email)).toEqual(["admin@ctyhp.vn", "intern1@ctyhp.vn"]);
  });
  it("combines search and filters", () => {
    expect(filterUsers(rows, { query: "ctyhp", role: "user", status: "active" }).map((r) => r.email)).toEqual(["intern1@ctyhp.vn"]);
  });
});

describe("fold", () => {
  it("lower-cases and strips accents, đ included", () => {
    expect(fold("Đặng Quốc VIỆT")).toBe("dang quoc viet");
  });
});
