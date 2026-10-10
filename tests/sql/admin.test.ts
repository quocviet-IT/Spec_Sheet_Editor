import { afterAll, describe, expect, it } from "vitest";
import { actAs, actAsOwner, closeDb, committed, connect, expectError, hasDb, insertSheet, makeUser, rollback, rollbackOn, staffEmail } from "./harness";

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

  it("TC-60 two Admins demoting each other at once are serialised and nothing is left behind", async () => {
    // The two Admins must be visible to both connections, so they are committed and deleted at the end. Both
    // demotions are rolled back: a committed role change writes an audit row that pins the account forever.
    const [x, y] = await committed(async (tx) => [await makeUser(tx, staffEmail(), "admin"), await makeUser(tx, staffEmail(), "admin")]);
    const one = connect();
    const two = connect();
    try {
      let releaseFirst!: () => void;
      const firstHolds = new Promise<void>((r) => (releaseFirst = r));
      let firstDemoted!: () => void;
      const firstIn = new Promise<void>((r) => (firstDemoted = r));

      // X demotes Y and keeps the transaction open, holding the guard's lock.
      const first = rollbackOn(one, async (tx) => {
        await actAs(tx, x);
        await tx`select public.set_user_role(${y.id}, 'user')`;
        firstDemoted();
        await firstHolds;
      });
      await firstIn;

      // Y demotes X at the same moment: it must wait for the lock, not run beside the first.
      let secondSettled = false;
      const second = rollbackOn(two, async (tx) => {
        await actAs(tx, y);
        await tx`select public.set_user_role(${x.id}, 'user')`;
      }).finally(() => (secondSettled = true));
      await new Promise((r) => setTimeout(r, 1500));
      expect(secondSettled, "the second demotion must wait while the first holds the lock").toBe(false);

      releaseFirst();
      const results = await Promise.allSettled([first, second]);
      // With the first rolled back the second goes through; either way neither is left half done.
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    } finally {
      await one.end();
      await two.end();
      await committed(async (tx) => {
        const [left] = await tx<{ n: string }[]>`select count(*) as n from public.profiles where id in (${x.id}, ${y.id}) and role = 'admin' and status = 'active'`;
        await tx`delete from auth.users where id in (${x.id}, ${y.id})`;
        expect(Number(left.n), "both rolled back: both are still active Admins").toBe(2);
      });
    }
  });
});
