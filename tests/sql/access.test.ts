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
      await expectError(tx, (sp) => sp`update public.profiles set role = 'admin' where id = ${staff.id}`, "permission denied");
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

  it("an email-and-password session is refused unless an Admin created the account", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      const claims = { sub: staff.id, email: staff.email, role: "authenticated", app_metadata: { provider: "email" } };
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      await tx`set local role authenticated`;
      const [row] = await tx<{ ok: boolean; s: string }[]>`select public.is_allowed_user() as ok, public.my_access_status() as s`;
      expect(row).toEqual({ ok: false, s: "not_permitted" });
    });
  });

  it("clients hold only the privileges the app needs", async () => {
    await rollback(async (tx) => {
      const [p] = await tx<Record<string, boolean>[]>`
        select has_table_privilege('authenticated', 'public.audit_log', 'truncate')   as audit_truncate,
               has_table_privilege('authenticated', 'public.audit_log', 'insert')     as audit_insert,
               has_table_privilege('authenticated', 'public.profiles', 'update')      as profiles_update,
               has_table_privilege('authenticated', 'public.spec_sheets', 'delete')   as sheets_delete,
               has_table_privilege('anon', 'public.spec_sheets', 'select')            as anon_sheets_select,
               has_function_privilege('anon', 'public.save_sheet(uuid, int, text, jsonb, jsonb)', 'execute') as anon_save,
               has_function_privilege('authenticated', 'public._audit(text, text, text, jsonb)', 'execute') as client_audit`;
      expect(Object.values(p).every((v) => v === false)).toBe(true);
      const [q] = await tx<{ sheets_insert: boolean; save: boolean }[]>`
        select has_table_privilege('authenticated', 'public.spec_sheets', 'insert') as sheets_insert,
               has_function_privilege('authenticated', 'public.save_sheet(uuid, int, text, jsonb, jsonb)', 'execute') as save`;
      expect(q).toEqual({ sheets_insert: true, save: true });
      const [s] = await tx<{ audit_insert: boolean; sheets_delete: boolean }[]>`
        select has_table_privilege('service_role', 'public.audit_log', 'insert')    as audit_insert,
               has_table_privilege('service_role', 'public.spec_sheets', 'delete')  as sheets_delete`;
      expect(s).toEqual({ audit_insert: true, sheets_delete: true });
    });
  });

  it("a function added by a later migration is not callable by clients until granted", async () => {
    await rollback(async (tx) => {
      await tx`create function public.zz_privilege_probe() returns int language sql as 'select 1'`;
      const [p] = await tx<{ authed: boolean; anon: boolean; service: boolean }[]>`
        select has_function_privilege('authenticated', 'public.zz_privilege_probe()', 'execute') as authed,
               has_function_privilege('anon', 'public.zz_privilege_probe()', 'execute')          as anon,
               has_function_privilege('service_role', 'public.zz_privilege_probe()', 'execute')  as service`;
      expect(p).toEqual({ authed: false, anon: false, service: true });
    });
  });
});
