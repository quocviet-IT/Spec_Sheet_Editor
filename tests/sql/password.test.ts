import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  actAs, actAsOwner, closeDb, expectError, hasDb, insertSheet, makePasswordUser, makeSignInAccount, makeUser,
  rollback, staffEmail, type Tx,
} from "./harness";

afterAll(closeDb);

async function status(tx: Tx): Promise<{ ok: boolean; s: string }> {
  const [row] = await tx<{ ok: boolean; s: string }[]>`select public.is_allowed_user() as ok, public.my_access_status() as s`;
  return row;
}

describe.skipIf(!hasDb)("password sign-in (BR-08, decisions of 2026-10-08)", () => {
  it("an account an Admin created may enter with a password session; a self-made email account may not", async () => {
    await rollback(async (tx) => {
      const member = await makePasswordUser(tx, `p-${randomUUID().slice(0, 8)}@gmail.com`);
      await actAs(tx, member, "email");
      expect(await status(tx)).toEqual({ ok: true, s: "ok" });
      await actAsOwner(tx);
      const stranger = await makeSignInAccount(tx, staffEmail());
      await actAs(tx, stranger, "email");
      expect(await status(tx)).toEqual({ ok: false, s: "not_permitted" });
    });
  });

  it("a one-time password blocks every read and write until the person sets their own", async () => {
    await rollback(async (tx) => {
      const other = await makeUser(tx, staffEmail());
      await actAs(tx, other);
      await insertSheet(tx, other);
      await actAsOwner(tx);
      const member = await makePasswordUser(tx, staffEmail(), { mustChange: true });
      await actAs(tx, member, "email");
      expect(await status(tx)).toEqual({ ok: false, s: "must_change_password" });
      expect((await tx`select id from public.spec_sheets`).length).toBe(0);
      await expectError(tx, (sp) => insertSheet(sp, member), "row-level security");
      await expectError(tx, (sp) => sp`select public.finish_password_change()`, "password_unchanged");

      await actAsOwner(tx);
      await tx`update auth.users set encrypted_password = 'changed-by-the-person' where id = ${member.id}`;
      await actAs(tx, member, "email");
      await tx`select public.finish_password_change()`;
      expect(await status(tx)).toEqual({ ok: true, s: "ok" });

      await actAsOwner(tx);
      const [snap] = await tx<{ hash: string; set_by: string }[]>`
        select hash, set_by from public.password_snapshots where user_id = ${member.id}`;
      expect(snap).toEqual({ hash: "changed-by-the-person", set_by: member.id });
      await actAs(tx, member, "email");
      await expectError(tx, (sp) => sp`select public.finish_password_change()`, "password_unchanged");
      await actAsOwner(tx);
      const audit = await tx<{ actor_id: string; detail: { replaced_one_time_password: boolean } }[]>`
        select actor_id, detail from public.audit_log where action = 'user.password_changed' and target_id = ${member.id}`;
      expect(audit.length).toBe(1);
      expect(audit[0].actor_id).toBe(member.id);
      expect(audit[0].detail.replaced_one_time_password).toBe(true);
    });
  });

  it("a voluntary password change is recorded only when the password really changed", async () => {
    await rollback(async (tx) => {
      const member = await makePasswordUser(tx, staffEmail());
      await actAs(tx, member, "email");
      await expectError(tx, (sp) => sp`select public.finish_password_change()`, "password_unchanged");
      await actAsOwner(tx);
      await tx`update auth.users set encrypted_password = 'chosen-by-the-person' where id = ${member.id}`;
      await actAs(tx, member, "email");
      await tx`select public.finish_password_change()`;
      await actAsOwner(tx);
      const audit = await tx<{ detail: { replaced_one_time_password: boolean } }[]>`
        select detail from public.audit_log where action = 'user.password_changed' and target_id = ${member.id}`;
      expect(audit.length).toBe(1);
      expect(audit[0].detail.replaced_one_time_password).toBe(false);
    });
  });

  it("a password account keeps the name its Admin entered, whatever the session claims", async () => {
    await rollback(async (tx) => {
      const member = await makePasswordUser(tx, staffEmail());
      await tx`update public.profiles set full_name = 'Name From Admin' where id = ${member.id}`;
      const name = async () => {
        await actAsOwner(tx);
        const [r] = await tx<{ full_name: string }[]>`select full_name from public.profiles where id = ${member.id}`;
        return r.full_name;
      };
      await actAs(tx, member, "email");
      await tx`select public.touch_profile()`;
      expect(await name()).toBe("Name From Admin");
      const claims = {
        sub: member.id, email: member.email, role: "authenticated",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: { full_name: "Typed By Person" },
      };
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      await tx`set local role authenticated`;
      await tx`select public.touch_profile()`;
      expect(await name()).toBe("Name From Admin");
    });
  });

  it("a suspended password account stays out, with or without a one-time password", async () => {
    await rollback(async (tx) => {
      const member = await makePasswordUser(tx, staffEmail(), { mustChange: true });
      await tx`update public.profiles set status = 'suspended' where id = ${member.id}`;
      await actAs(tx, member, "email");
      expect(await status(tx)).toEqual({ ok: false, s: "suspended" });
      await expectError(tx, (sp) => sp`select public.finish_password_change()`, "forbidden");
    });
  });

  it("an Admin registers a sign-in account created moments earlier, and it is audited", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      const account = await makeSignInAccount(tx, "New.Person@CTYHP.vn");
      await actAs(tx, admin);
      await tx`select public.admin_register_password_account(${account.id}, ${"  Nguyen Van A  "}, 'user')`;
      await actAsOwner(tx);
      const [p] = await tx<{ email: string; full_name: string; role: string; password_account: boolean; must_change_password: boolean }[]>`
        select email, full_name, role, password_account, must_change_password from public.profiles where id = ${account.id}`;
      expect(p).toEqual({ email: "new.person@ctyhp.vn", full_name: "Nguyen Van A", role: "user", password_account: true, must_change_password: true });
      const [h] = await tx<{ hash: string; set_by: string }[]>`
        select hash, set_by from public.password_snapshots where user_id = ${account.id}`;
      expect(h).toEqual({ hash: account.hash, set_by: admin.id });
      const [a] = await tx<{ actor_id: string; detail: { email: string; role: string } }[]>`
        select actor_id, detail from public.audit_log where action = 'user.create' and target_id = ${account.id}`;
      expect(a.actor_id).toBe(admin.id);
      expect(a.detail).toMatchObject({ email: "new.person@ctyhp.vn", role: "user" });
    });
  });

  it("an account registered as Admin is an Admin only after it replaces the one-time password", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      const account = await makeSignInAccount(tx, staffEmail());
      await actAs(tx, admin);
      await tx`select public.admin_register_password_account(${account.id}, 'New Admin', 'admin')`;
      await actAsOwner(tx);
      const [p] = await tx<{ role: string; must_change_password: boolean }[]>`
        select role, must_change_password from public.profiles where id = ${account.id}`;
      expect(p).toEqual({ role: "admin", must_change_password: true });
      await actAs(tx, account, "email");
      const [a] = await tx<{ admin: boolean }[]>`select public.is_admin() as admin`;
      expect(a.admin).toBe(false);
    });
  });

  it("registration is refused for Staff and for anything but a fresh, unregistered email-provider account", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      const staff = await makeUser(tx, staffEmail());
      const fresh = await makeSignInAccount(tx, staffEmail());
      const google = await makeSignInAccount(tx, staffEmail(), { provider: "google" });
      const old = await makeSignInAccount(tx, staffEmail(), { createdAt: new Date(Date.now() - 60 * 60 * 1000) });
      const taken = await makePasswordUser(tx, staffEmail());

      await actAs(tx, staff);
      await expectError(tx, (sp) => sp`select public.admin_register_password_account(${fresh.id}, 'A', 'user')`, "forbidden");
      await actAs(tx, admin);
      await expectError(tx, (sp) => sp`select public.admin_register_password_account(${fresh.id}, 'A', 'owner')`, "bad_role");
      await expectError(tx, (sp) => sp`select public.admin_register_password_account(${fresh.id}, '   ', 'user')`, "bad_name");
      await expectError(tx, (sp) => sp`select public.admin_register_password_account(${fresh.id}, ${"x".repeat(121)}, 'user')`, "bad_name");
      await expectError(tx, (sp) => sp`select public.admin_register_password_account(${randomUUID()}, 'A', 'user')`, "user_not_found");
      await expectError(tx, (sp) => sp`select public.admin_register_password_account(${google.id}, 'A', 'user')`, "not_password_account");
      await expectError(tx, (sp) => sp`select public.admin_register_password_account(${old.id}, 'A', 'user')`, "stale_account");
      await expectError(tx, (sp) => sp`select public.admin_register_password_account(${taken.id}, 'A', 'user')`, "already_registered");
    });
  });

  it("an Admin's reset brings back the one-time password rule, ends every session and is audited", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      const member = await makePasswordUser(tx, staffEmail());
      await tx`insert into auth.sessions (id, user_id, created_at) values (${randomUUID()}, ${member.id}, now())`;
      // what auth.admin.updateUserById does before the app calls the function
      await tx`update auth.users set encrypted_password = 'new-one-time-hash' where id = ${member.id}`;
      await actAs(tx, admin);
      await tx`select public.admin_mark_password_reset(${member.id})`;
      await actAsOwner(tx);
      const [p] = await tx<{ must_change_password: boolean }[]>`select must_change_password from public.profiles where id = ${member.id}`;
      expect(p.must_change_password).toBe(true);
      const [h] = await tx<{ hash: string; set_by: string }[]>`select hash, set_by from public.password_snapshots where user_id = ${member.id}`;
      expect(h).toEqual({ hash: "new-one-time-hash", set_by: admin.id });
      expect((await tx`select 1 from auth.sessions where user_id = ${member.id}`).length).toBe(0);
      const [a] = await tx<{ actor_id: string }[]>`
        select actor_id from public.audit_log where action = 'user.password_reset' and target_id = ${member.id}`;
      expect(a.actor_id).toBe(admin.id);
    });
  });

  it("a reset is refused for Staff, for the Admin's own account and for an account that is not a password account", async () => {
    await rollback(async (tx) => {
      const admin = await makePasswordUser(tx, staffEmail(), { role: "admin" });
      const staff = await makeUser(tx, staffEmail());
      const member = await makePasswordUser(tx, staffEmail());
      await actAs(tx, staff);
      await expectError(tx, (sp) => sp`select public.admin_mark_password_reset(${member.id})`, "forbidden");
      await actAs(tx, admin, "email");
      await expectError(tx, (sp) => sp`select public.admin_mark_password_reset(${admin.id})`, "self_reset");
      await expectError(tx, (sp) => sp`select public.admin_mark_password_reset(${staff.id})`, "not_password_account");
    });
  });

  it("clients cannot read the one-time password hashes or set the new profile flags themselves", async () => {
    await rollback(async (tx) => {
      const [p] = await tx<Record<string, boolean>[]>`
        select has_table_privilege('authenticated', 'public.password_snapshots', 'select') as snapshot_select,
               has_table_privilege('anon', 'public.password_snapshots', 'select')          as anon_select,
               has_function_privilege('anon', 'public.finish_password_change()', 'execute') as anon_finish`;
      expect(Object.values(p).every((v) => v === false)).toBe(true);
      const [q] = await tx<Record<string, boolean>[]>`
        select has_function_privilege('authenticated', 'public.finish_password_change()', 'execute') as finish,
               has_function_privilege('authenticated', 'public.admin_mark_password_reset(uuid)', 'execute') as reset,
               has_function_privilege('authenticated', 'public.admin_register_password_account(uuid, text, text)', 'execute') as register`;
      expect(Object.values(q).every((v) => v === true)).toBe(true);
      const member = await makePasswordUser(tx, staffEmail(), { mustChange: true });
      await actAs(tx, member, "email");
      await expectError(tx, (sp) => sp`select * from public.password_snapshots`, "permission denied");
      await expectError(tx, (sp) => sp`update public.profiles set must_change_password = false where id = ${member.id}`, "permission denied");
    });
  });
});
