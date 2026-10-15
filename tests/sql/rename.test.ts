import { afterAll, describe, expect, it } from "vitest";
import { actAs, actAsOwner, applyMigration, closeDb, expectError, hasDb, makePasswordUser, makeUser, rollback, staffEmail, type Tx } from "./harness";

afterAll(closeDb);

const MIGRATION = "0006_rename_user.sql";

async function world(tx: Tx) {
  await applyMigration(tx, MIGRATION);
  return {
    admin: await makeUser(tx, staffEmail(), "admin"),
    staff: await makePasswordUser(tx, staffEmail()),
    google: await makeUser(tx, staffEmail()),
  };
}

const nameOf = async (tx: Tx, id: string) => (await tx<{ full_name: string | null }[]>`select full_name from public.profiles where id = ${id}`)[0].full_name;
const renames = (tx: Tx, id: string) =>
  tx<{ actor_id: string; detail: { email: string; from: string | null; to: string } }[]>`
    select actor_id, detail from public.audit_log where action = 'user.rename' and target_id = ${id} order by id`;

describe.skipIf(!hasDb)("rename a password account (0006)", () => {
  it("an Admin renames a password account; the name is trimmed and the change is audited with the old and new name", async () => {
    await rollback(async (tx) => {
      const { admin, staff } = await world(tx);
      const before = await nameOf(tx, staff.id);
      await actAs(tx, admin);
      await tx`select public.rename_user(${staff.id}, ${"  Nguyễn Văn A  "})`;
      await actAsOwner(tx);
      expect(await nameOf(tx, staff.id)).toBe("Nguyễn Văn A");
      const log = await renames(tx, staff.id);
      expect(log).toHaveLength(1);
      expect(log[0].actor_id).toBe(admin.id);
      expect(log[0].detail).toEqual({ email: staff.email, from: before, to: "Nguyễn Văn A" });
    });
  });

  it("the same name again changes and records nothing", async () => {
    await rollback(async (tx) => {
      const { admin, staff } = await world(tx);
      const before = await nameOf(tx, staff.id);
      await actAs(tx, admin);
      await tx`select public.rename_user(${staff.id}, ${` ${before} `})`;
      await actAsOwner(tx);
      expect(await renames(tx, staff.id)).toHaveLength(0);
    });
  });

  it("an Admin may rename their own password account", async () => {
    await rollback(async (tx) => {
      const { staff } = await world(tx);
      await tx`update public.profiles set role = 'admin' where id = ${staff.id}`;
      await actAs(tx, staff, "email");
      await tx`select public.rename_user(${staff.id}, 'Admin')`;
      await actAsOwner(tx);
      expect(await nameOf(tx, staff.id)).toBe("Admin");
    });
  });

  it("Staff cannot rename anyone, themselves included", async () => {
    await rollback(async (tx) => {
      const { staff, admin } = await world(tx);
      await actAs(tx, staff, "email");
      await expectError(tx, (sp) => sp`select public.rename_user(${staff.id}, 'Someone')`, "forbidden");
      await expectError(tx, (sp) => sp`select public.rename_user(${admin.id}, 'Someone')`, "forbidden");
    });
  });

  it("refuses an empty or too long name, a Google account and an unknown account", async () => {
    await rollback(async (tx) => {
      const { admin, staff, google } = await world(tx);
      await actAs(tx, admin);
      await expectError(tx, (sp) => sp`select public.rename_user(${staff.id}, '   ')`, "bad_name");
      await expectError(tx, (sp) => sp`select public.rename_user(${staff.id}, ${null})`, "bad_name");
      await expectError(tx, (sp) => sp`select public.rename_user(${staff.id}, ${"x".repeat(121)})`, "bad_name");
      await tx`select public.rename_user(${staff.id}, ${"x".repeat(120)})`;
      // a Google account takes its name from Google at every sign-in, so a new name would not last
      await expectError(tx, (sp) => sp`select public.rename_user(${google.id}, 'Someone')`, "not_password_account");
      await expectError(tx, (sp) => sp`select public.rename_user(gen_random_uuid(), 'Someone')`, "user_not_found");
    });
  });

  it("the new name survives the person's next sign-in", async () => {
    await rollback(async (tx) => {
      const { admin, staff } = await world(tx);
      await actAs(tx, admin);
      await tx`select public.rename_user(${staff.id}, 'Trần Thị B')`;
      await actAsOwner(tx);
      await actAs(tx, staff, "email");
      await tx`select public.touch_profile()`;
      await actAsOwner(tx);
      expect(await nameOf(tx, staff.id)).toBe("Trần Thị B");
    });
  });

  it("clients cannot call it without signing in", async () => {
    await rollback(async (tx) => {
      await world(tx);
      await tx`set local role anon`;
      await expectError(tx, (sp) => sp`select public.rename_user(gen_random_uuid(), 'x')`, "permission denied");
    });
  });
});
