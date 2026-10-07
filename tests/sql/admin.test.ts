import { afterAll, describe, expect, it } from "vitest";
import { actAs, actAsOwner, closeDb, expectError, hasDb, insertSheet, makeUser, rollback, staffEmail } from "./harness";

afterAll(closeDb);

describe.skipIf(!hasDb)("admin functions", () => {
  it("TC-56 Staff cannot call admin functions", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await actAs(tx, staff);
      await expectError(tx, (sp) => sp`select public.set_user_role(${staff.id}, 'admin')`, "forbidden");
      await expectError(tx, (sp) => sp`select public.set_setting('max_file_mb', 30)`, "forbidden");
      await expectError(tx, (sp) => sp`select public.purge_sheet(gen_random_uuid())`, "forbidden");
    });
  });

  it("TC-59 the last active Admin cannot be demoted", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      // Make the test independent of real Admins in this database (rolled back afterwards).
      await tx`update public.profiles set role = 'user' where role = 'admin' and id <> ${admin.id}`;
      await actAs(tx, admin);
      await expectError(tx, (sp) => sp`select public.set_user_role(${admin.id}, 'user')`, "last_admin");
    });
  });

  it("an Admin can promote Staff, and the change is audited", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      const staff = await makeUser(tx, staffEmail());
      await actAs(tx, admin);
      await tx`select public.set_user_role(${staff.id}, 'admin')`;
      await actAsOwner(tx);
      const [p] = await tx<{ role: string }[]>`select role from public.profiles where id = ${staff.id}`;
      expect(p.role).toBe("admin");
      const log = await tx`select 1 from public.audit_log where action = 'user.role_change' and target_id = ${staff.id}`;
      expect(log.length).toBe(1);
    });
  });

  it("TC-61 an Admin cannot suspend themselves", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      await actAs(tx, admin);
      await expectError(tx, (sp) => sp`select public.set_user_status(${admin.id}, 'suspended')`, "self_suspend");
    });
  });

  it("TC-65 removing the Admin's own domain is refused and nothing changes", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      await actAs(tx, admin);
      await expectError(tx, (sp) => sp`select public.remove_allowed('domain', 'ctyhp.vn')`, "self_lockout");
      await actAsOwner(tx);
      const rows = await tx`select 1 from public.allowed_domains where domain = 'ctyhp.vn'`;
      expect(rows.length).toBe(1);
    });
  });

  it("TC-73 a sheet must be in the Trash before it can be purged", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      await actAs(tx, admin);
      const id = await insertSheet(tx, admin);
      await expectError(tx, (sp) => sp`select public.purge_sheet(${id})`, "not_in_trash");
    });
  });

  it("admin functions refuse an unknown account or list kind instead of doing nothing", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      await actAs(tx, admin);
      await expectError(tx, (sp) => sp`select public.set_user_role(gen_random_uuid(), 'admin')`, "user_not_found");
      await expectError(tx, (sp) => sp`select public.set_user_status(gen_random_uuid(), 'suspended')`, "user_not_found");
      await expectError(tx, (sp) => sp`select public.add_allowed('bogus', 'x@ctyhp.vn', null)`, "invalid_kind");
      await expectError(tx, (sp) => sp`select public.remove_allowed('bogus', 'ctyhp.vn')`, "invalid_kind");
    });
  });
});
