import { afterAll, describe, expect, it } from "vitest";
import { actAs, actAsOwner, closeDb, expectError, hasDb, insertSheet, makeUser, rollback, staffEmail } from "./harness";

afterAll(closeDb);

describe.skipIf(!hasDb)("audit log (BR-15)", () => {
  it("TC-69 cannot be updated, deleted or truncated, even by the owner", async () => {
    await rollback(async (tx) => {
      await expectError(tx, (sp) => sp`update public.audit_log set action = 'x'`, "append-only");
      await expectError(tx, (sp) => sp`delete from public.audit_log`, "append-only");
      await expectError(tx, (sp) => sp`truncate public.audit_log`, "append-only");
    });
  });

  it("TC-70 clients cannot forge actions", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await actAs(tx, staff);
      await expectError(
        tx,
        (sp) => sp`select public.log_client_event('user.role_change', gen_random_uuid(), '{}')`,
        "action_not_allowed",
      );
    });
  });

  it("TC-71 Staff read no audit rows", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await actAs(tx, staff);
      await tx`select public.touch_profile()`; // writes an auth.login row for this user
      const rows = await tx`select id from public.audit_log`;
      expect(rows.length).toBe(0);
    });
  });

  it("an account with audit history cannot be deleted; it is suspended instead (BR-13)", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await actAs(tx, staff);
      await tx`select public.touch_profile()`; // writes an auth.login row for this user
      await actAsOwner(tx);
      await expectError(tx, (sp) => sp`delete from public.profiles where id = ${staff.id}`, "audit_log_actor_id_fkey");
    });
  });

  it("export events need a real sheet and a small detail, and are recorded", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await actAs(tx, staff);
      const id = await insertSheet(tx, staff);
      const big = JSON.stringify({ note: "x".repeat(3000) });
      await expectError(tx, (sp) => sp`select public.log_client_event('sheet.export_pdf', ${id}, ${big}::jsonb)`, "detail_too_large");
      await expectError(tx, (sp) => sp`select public.log_client_event('sheet.export_pdf', gen_random_uuid(), '{}')`, "sheet_not_found");
      await tx`select public.log_client_event('sheet.export_pdf', ${id}, '{"pages":1}')`;
      await actAsOwner(tx);
      const rows = await tx`select 1 from public.audit_log where action = 'sheet.export_pdf' and target_id = ${id}`;
      expect(rows.length).toBe(1);
    });
  });
});
