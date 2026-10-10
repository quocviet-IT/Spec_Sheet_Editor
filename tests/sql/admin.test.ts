import { afterAll, describe, expect, it } from "vitest";
import { actAs, actAsOwner, closeDb, connect, expectError, hasDb, insertSheet, makeUser, rollback, rollbackOn, staffEmail } from "./harness";

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

  // Proves that demotions are serialised by the guard's global advisory lock (trg_profile_guard in 0001_init.sql),
  // so two Admins demoting each other cannot both pass the last-admin check. It does not run the full
  // "exactly one Admin remains" outcome: that needs a commit, and the shared database holds real Admins, so the
  // last-admin check would not fire anyway. TC-59 covers the single-session outcome. Everything here lives in
  // transactions that are rolled back; nothing is committed.
  it("TC-60 demotions by two Admins at once are serialised by the guard lock (rolled back, nothing committed)", async () => {
    const one = connect();
    const two = connect();
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const within = <T>(p: Promise<T>, ms: number, what: string) =>
      Promise.race([p, wait(ms).then(() => Promise.reject(new Error(`timed out waiting for ${what}`)))]);
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let holding!: () => void;
    const holdingP = new Promise<void>((r) => (holding = r));
    let waiterSeen = false;
    let secondSettled = false;
    let results: PromiseSettledResult<void>[] = [];
    try {
      // Connection A: its own Admin pair; X demotes Y and keeps the transaction open, holding the lock.
      const first = rollbackOn(one, async (tx) => {
        const [x, y] = [await makeUser(tx, staffEmail(), "admin"), await makeUser(tx, staffEmail(), "admin")];
        await actAs(tx, x);
        await tx`select public.set_user_role(${y.id}, 'user')`;
        await actAsOwner(tx);
        holding();
        // wait until the other connection is queued on an advisory lock, then until told to let go
        for (let i = 0; i < 100 && !waiterSeen; i++) {
          const [w] = await tx<{ n: string }[]>`select count(*) as n from pg_locks where locktype = 'advisory' and not granted`;
          waiterSeen = Number(w.n) > 0;
          if (!waiterSeen) await wait(100);
        }
        await released;
      });
      await within(Promise.race([holdingP, first]), 15_000, "connection A to take the lock");

      // Connection B: its own pair, the same call; it must queue behind A instead of running beside it.
      const second = rollbackOn(two, async (tx) => {
        const [p, q] = [await makeUser(tx, staffEmail(), "admin"), await makeUser(tx, staffEmail(), "admin")];
        await actAs(tx, p);
        await tx`select public.set_user_role(${q.id}, 'user')`;
      }).finally(() => (secondSettled = true));
      second.catch(() => {});
      await within((async () => { while (!waiterSeen) await wait(50); })(), 10_000, "B to queue on the lock");
      await wait(500);
      const pendingWhileHeld = !secondSettled;

      // Roll A back first: the lock holder is released before waiting on B.
      release();
      results = await within(Promise.allSettled([first, second]), 20_000, "both transactions to finish");
      expect(pendingWhileHeld, "the second demotion must wait while the first holds the lock").toBe(true);
      expect(waiterSeen, "a waiter was queued on the advisory lock").toBe(true);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    } finally {
      release();
      await Promise.allSettled([one.end({ timeout: 5 }), two.end({ timeout: 5 })]);
    }
  }, 60_000);
});
