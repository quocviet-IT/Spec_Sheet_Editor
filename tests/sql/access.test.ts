import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { actAs, actAsOwner, closeDb, expectError, hasDb, insertSheet, makeUser, rollback, staffEmail, type Tx } from "./harness";

afterAll(closeDb);

describe.skipIf(!hasDb)("access rules (BR-08)", () => {
  async function allowed(tx: Tx, email: string) {
    await actAs(tx, { id: randomUUID(), email });
    const [row] = await tx<{ ok: boolean }[]>`select public.is_allowed_user() as ok`;
    await actAsOwner(tx);
    return row.ok;
  }

  it("TC-03 rejects look-alike domains", async () => {
    await rollback(async (tx) => {
      expect(await allowed(tx, "a@xctyhp.vn")).toBe(false);
      expect(await allowed(tx, "a@ctyhp.vn.evil.com")).toBe(false);
      expect(await allowed(tx, "a@b@ctyhp.vn")).toBe(false);
      expect(await allowed(tx, "a@ctyhp.vn")).toBe(true);
    });
  });

  it("TC-04 ignores letter case", async () => {
    await rollback(async (tx) => {
      expect(await allowed(tx, "A@CTYHP.VN")).toBe(true);
    });
  });

  it("TC-05 hides sheets from, and refuses inserts by, a non-permitted account", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      const outsider = await makeUser(tx, `x-${randomUUID().slice(0, 8)}@gmail.com`);
      await actAs(tx, staff);
      await insertSheet(tx, staff);
      await actAs(tx, outsider);
      const rows = await tx`select id from public.spec_sheets`;
      expect(rows.length).toBe(0);
      await expectError(tx, (sp) => insertSheet(sp, outsider), "row-level security");
    });
  });

  it("TC-57 Staff cannot promote themselves", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await actAs(tx, staff);
      const updated = await tx`update public.profiles set role = 'admin' where id = ${staff.id} returning id`;
      expect(updated.length).toBe(0);
      await actAsOwner(tx);
      const [p] = await tx<{ role: string }[]>`select role from public.profiles where id = ${staff.id}`;
      expect(p.role).toBe("user");
    });
  });

  it("my_access_status tells suspended from not permitted", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await tx`update public.profiles set status = 'suspended' where id = ${staff.id}`;
      await actAs(tx, staff);
      const [a] = await tx<{ s: string }[]>`select public.my_access_status() as s`;
      expect(a.s).toBe("suspended");
      await actAs(tx, { id: randomUUID(), email: "y@gmail.com" });
      const [b] = await tx<{ s: string }[]>`select public.my_access_status() as s`;
      expect(b.s).toBe("not_permitted");
    });
  });

  it("TC-49 / TC-50 storage: only read and insert policies, both gated by is_allowed_user()", async () => {
    await rollback(async (tx) => {
      const policies = await tx<{ cmd: string; qual: string | null; with_check: string | null }[]>`
        select cmd, qual, with_check from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and coalesce(qual, '') || coalesce(with_check, '') like '%spec-sheets%'`;
      expect(policies.map((p) => p.cmd).sort()).toEqual(["INSERT", "SELECT"]);
      for (const p of policies) expect(`${p.qual ?? ""}${p.with_check ?? ""}`).toContain("is_allowed_user");
    });
  });
});
