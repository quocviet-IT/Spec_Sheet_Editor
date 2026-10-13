import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  actAs, actAsOwner, applyMigration, closeDb, expectError, hasDb, insertReportAsOwner, makeUser, rollback, staffEmail, type Tx,
} from "./harness";

afterAll(closeDb);

const MIGRATION = "0005_feedback.sql";
const BUCKET = "feedback-screenshots";

async function world(tx: Tx) {
  await applyMigration(tx, MIGRATION);
  return { a: await makeUser(tx, staffEmail()), b: await makeUser(tx, staffEmail()), admin: await makeUser(tx, staffEmail(), "admin") };
}

/** Files a report with the current role (use after actAs to exercise RLS); `extra` adds or overrides columns. */
const file = (tx: Tx, reporter: string, extra: Record<string, string> = {}) =>
  tx<{ id: string }[]>`insert into public.feedback_reports ${tx({
    kind: "misread", impact: "blocking", description: "The 6.03 was read as 6.08",
    page_url: "/sheets/x", page_route: "/sheets/[id]", page_label: "Editor", reporter_id: reporter, ...extra,
  })} returning id`;

describe.skipIf(!hasDb)("feedback (0005)", () => {
  it("Staff file their own report as new; never with triage fields or for someone else", async () => {
    await rollback(async (tx) => {
      const { a, b } = await world(tx);
      await actAs(tx, a);
      const [ok] = await file(tx, a.id);
      expect(ok.id).toMatch(/^[0-9a-f-]{36}$/);
      await expectError(tx, (sp) => file(sp, b.id), "row-level security");
      await expectError(tx, (sp) => file(sp, a.id, { status: "fixed" }), "row-level security");
      await expectError(tx, (sp) => file(sp, a.id, { triage_note: "x" }), "row-level security");
      await expectError(tx, (sp) => sp`insert into public.feedback_reports (kind, impact, description, page_url, page_route, page_label, reporter_id)
                                        values ('broken', 'minor', '  ab ', '/', '/', 'x', ${a.id})`, "check constraint");
    });
  });

  it("a reporter reads their own reports, an Admin reads every report, nobody else reads them", async () => {
    await rollback(async (tx) => {
      const { a, b, admin } = await world(tx);
      const mine = await insertReportAsOwner(tx, a);
      const read = async () => (await tx<{ id: string }[]>`select id from public.feedback_reports where id = ${mine}`).length;
      await actAs(tx, a);
      expect(await read()).toBe(1);
      await actAsOwner(tx);
      await actAs(tx, b);
      expect(await read()).toBe(0);
      await actAsOwner(tx);
      await actAs(tx, admin);
      expect(await read()).toBe(1);
    });
  });

  it("a filed report is evidence: clients cannot update it, and even the owner role cannot change its content", async () => {
    await rollback(async (tx) => {
      const { a } = await world(tx);
      const id = await insertReportAsOwner(tx, a);
      await actAs(tx, a);
      // clients hold no UPDATE privilege at all, so the statement is refused before any policy is consulted
      await expectError(tx, (sp) => sp`update public.feedback_reports set description = 'Something else entirely' where id = ${id} returning id`, "permission denied");
      await actAsOwner(tx);
      await expectError(tx, (sp) => sp`update public.feedback_reports set description = 'Rewritten afterwards' where id = ${id}`, "feedback_is_evidence");
      await tx`update public.feedback_reports set screenshot_path = ${`${id}/${randomUUID()}.png`} where id = ${id}`;
      await expectError(tx, (sp) => sp`update public.feedback_reports set screenshot_path = null where id = ${id}`, "screenshot_already_attached");
    });
  });

  it("only an Admin moves a report; declining needs a reason; a null note keeps the old one; every move is audited", async () => {
    await rollback(async (tx) => {
      const { a, admin } = await world(tx);
      const id = await insertReportAsOwner(tx, a);
      await actAs(tx, a);
      await expectError(tx, (sp) => sp`select public.set_feedback_status(${id}::uuid, 'fixed', null)`, "forbidden");
      await actAsOwner(tx);
      await actAs(tx, admin);
      await expectError(tx, (sp) => sp`select public.set_feedback_status(${id}::uuid, 'declined', '  ')`, "decline_needs_reason");
      await tx`select public.set_feedback_status(${id}::uuid, 'looking', 'Reproduced on the test sheet')`;
      await tx`select public.set_feedback_status(${id}::uuid, 'declined', null)`; // the kept note is the reason
      await expectError(tx, (sp) => sp`select public.set_feedback_status(${id}::uuid, 'gone', null)`, "invalid_status");
      await tx`select public.set_feedback_status(${id}::uuid, 'declined', null)`; // a no-op: no audit entry below, no new triage time
      await actAsOwner(tx);
      const [row] = await tx<{ status: string; triage_note: string; triaged_by: string }[]>`select status, triage_note, triaged_by from public.feedback_reports where id = ${id}`;
      expect(row).toEqual({ status: "declined", triage_note: "Reproduced on the test sheet", triaged_by: admin.id });
      const audit = await tx<{ action: string }[]>`select action from public.audit_log where target_type = 'feedback' and target_id = ${id} order by id`;
      expect(audit.map((r) => r.action)).toEqual(["feedback.file", "feedback.status", "feedback.status"]); // the owner insert is audited too
    });
  });

  it("filing is audited, and the server sets the filing time", async () => {
    await rollback(async (tx) => {
      const { a } = await world(tx);
      await actAs(tx, a);
      const [r] = await file(tx, a.id, { created_at: "2001-01-01T00:00:00Z" });
      await actAsOwner(tx);
      const [row] = await tx<{ old: boolean }[]>`select created_at < now() - interval '1 day' as old from public.feedback_reports where id = ${r.id}`;
      expect(row.old).toBe(false);
      const audit = await tx<{ action: string }[]>`select action from public.audit_log where target_type = 'feedback' and target_id = ${r.id}`;
      expect(audit.map((x) => x.action)).toEqual(["feedback.file"]);
    });
  });

  it("a picture goes into one's own report folder once; it is attached only when it is there; reporter and Admin read it", async () => {
    await rollback(async (tx) => {
      const { a, b, admin } = await world(tx);
      const mine = await insertReportAsOwner(tx, a);
      const theirs = await insertReportAsOwner(tx, b);
      const path = `${mine}/${randomUUID()}.png`;
      await actAs(tx, a);
      await expectError(tx, (sp) => sp`select public.attach_feedback_screenshot(${mine}::uuid, ${path})`, "file_missing");
      await expectError(tx, (sp) => sp`insert into storage.objects (bucket_id, name, owner, owner_id) values (${BUCKET}, ${`${theirs}/${randomUUID()}.png`}, ${a.id}, ${a.id})`, "row-level security");
      await expectError(tx, (sp) => sp`insert into storage.objects (bucket_id, name, owner, owner_id) values (${BUCKET}, ${`${mine}/not-a-uuid.png`}, ${a.id}, ${a.id})`, "row-level security");
      // RETURNING, as the storage service inserts: the new row must also pass the read policy before it is attached
      const [uploaded] = await tx<{ name: string }[]>`insert into storage.objects (bucket_id, name, owner, owner_id) values (${BUCKET}, ${path}, ${a.id}, ${a.id}) returning name`;
      expect(uploaded.name).toBe(path);
      await expectError(tx, (sp) => sp`insert into storage.objects (bucket_id, name, owner, owner_id) values (${BUCKET}, ${`${mine}/${randomUUID()}.png`}, ${a.id}, ${a.id})`, "row-level security");
      await expectError(tx, (sp) => sp`select public.attach_feedback_screenshot(${theirs}::uuid, ${path})`, "not_found");
      await tx`select public.attach_feedback_screenshot(${mine}::uuid, ${path})`;
      await expectError(tx, (sp) => sp`select public.attach_feedback_screenshot(${mine}::uuid, ${path})`, "screenshot_already_attached");
      const seen = async () => (await tx`select 1 from storage.objects where bucket_id = ${BUCKET} and name = ${path}`).length;
      expect(await seen()).toBe(1);
      await actAsOwner(tx);
      await actAs(tx, b);
      expect(await seen()).toBe(0);
      await actAsOwner(tx);
      await actAs(tx, admin);
      expect(await seen()).toBe(1);
    });
  });

  it("the unread count: New reports for an Admin, one's own moved reports for Staff, cleared by marking seen", async () => {
    await rollback(async (tx) => {
      const { a, admin } = await world(tx);
      await insertReportAsOwner(tx, a, { status: "looking", note: "On it", triagedAt: new Date("2020-01-01T00:00:00Z") }); // long past, so no clock skew can put it after the visit
      await insertReportAsOwner(tx, a);
      await actAs(tx, a);
      const unseen = async () => (await tx<{ n: number }[]>`select public.feedback_unseen() as n`)[0].n;
      expect(await unseen()).toBe(1);
      await tx`select public.mark_feedback_seen()`;
      expect(await unseen()).toBe(0);
      await actAsOwner(tx);
      await actAs(tx, admin);
      const counts = await tx<{ status: string; n: string }[]>`select status, n::text from public.feedback_counts()`;
      expect(Number(counts.find((c) => c.status === "new")?.n ?? 0)).toBeGreaterThanOrEqual(1);
      expect(await unseen()).toBeGreaterThanOrEqual(1);
    });
  });

  it("the migration can be applied twice, and anonymous visitors hold no rights", async () => {
    await rollback(async (tx) => {
      await applyMigration(tx, MIGRATION);
      await applyMigration(tx, MIGRATION);
      const [p] = await tx<Record<string, boolean>[]>`
        select has_table_privilege('anon', 'public.feedback_reports', 'select') as anon_read,
               has_function_privilege('anon', 'public.set_feedback_status(uuid, text, text)', 'execute') as anon_triage,
               has_function_privilege('authenticated', 'public.attach_feedback_screenshot(uuid, text)', 'execute') as attach,
               has_table_privilege('authenticated', 'public.feedback_reports', 'update') as client_update`;
      expect(p).toEqual({ anon_read: false, anon_triage: false, attach: true, client_update: false });
    });
  });
});
