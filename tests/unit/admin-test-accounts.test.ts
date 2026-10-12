import { describe, expect, it } from "vitest";
import { isTestAccount, splitTestAccounts, TEST_ACCOUNT_EMAILS } from "@/admin/test-accounts";

describe("reserved test accounts", () => {
  it("are the three end-to-end accounts", () => {
    expect([...TEST_ACCOUNT_EMAILS].sort()).toEqual(["e2e-admin@ctyhp.vn", "e2e-staff-b@ctyhp.vn", "e2e-staff@ctyhp.vn"]);
  });

  it("are recognised by exact email, in any case", () => {
    expect(isTestAccount("E2E-Staff@ctyhp.vn")).toBe(true);
    expect(isTestAccount("e2e-staff@ctyhp.vn.example")).toBe(false);
    expect(isTestAccount("x-e2e-staff@ctyhp.vn")).toBe(false);
    expect(isTestAccount("admin@ctyhp.vn")).toBe(false);
  });

  it("are split from real people without changing either order", () => {
    const rows = [
      { email: "b@ctyhp.vn" },
      { email: "e2e-admin@ctyhp.vn" },
      { email: "a@ctyhp.vn" },
      { email: "e2e-staff@ctyhp.vn" },
    ];
    expect(splitTestAccounts(rows)).toEqual({
      people: [{ email: "b@ctyhp.vn" }, { email: "a@ctyhp.vn" }],
      tests: [{ email: "e2e-admin@ctyhp.vn" }, { email: "e2e-staff@ctyhp.vn" }],
    });
  });
});
