import { afterAll, describe, expect, it } from "vitest";
import { actAs, actAsOwner, closeDb, expectError, hasDb, insertSheet, makeUser, rollback, staffEmail } from "./harness";

afterAll(closeDb);

type SaveRow = { saved: boolean; new_version: number; is_deleted: boolean; by_name: string | null };

describe.skipIf(!hasDb)("sheets", () => {
  it("save_sheet saves on a matching version and reports a conflict otherwise (BR-10)", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      const id = await insertSheet(tx, a);
      const [first] = await tx<SaveRow[]>`select * from public.save_sheet(${id}, 1, null, null, '[{"x":1}]'::jsonb)`;
      expect(first).toMatchObject({ saved: true, new_version: 2 });
      const [stale] = await tx<SaveRow[]>`select * from public.save_sheet(${id}, 1, null, null, '[]'::jsonb)`;
      expect(stale).toMatchObject({ saved: false, new_version: 2, is_deleted: false });
      expect(stale.by_name).toBe(a.email.split("@")[0]);
    });
  });

  it("save_sheet reports a sheet moved to the Trash", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      const id = await insertSheet(tx, a);
      await tx`update public.spec_sheets set deleted_at = now(), deleted_by = ${a.id}, updated_by = ${a.id} where id = ${id}`;
      const [row] = await tx<SaveRow[]>`select * from public.save_sheet(${id}, 1, null, null, '[]'::jsonb)`;
      expect(row).toMatchObject({ saved: false, is_deleted: true });
    });
  });

  it("immutable columns cannot change", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      const id = await insertSheet(tx, a);
      await expectError(
        tx,
        (sp) => sp`update public.spec_sheets set source_path = 'other/source.png', updated_by = ${a.id} where id = ${id}`,
        "immutable_column",
      );
    });
  });

  it("a direct edit without a version bump is refused: content changes go through save_sheet (BR-10)", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      const id = await insertSheet(tx, a);
      await expectError(
        tx,
        (sp) => sp`update public.spec_sheets set edits = '[{"x":9}]'::jsonb, updated_by = ${a.id} where id = ${id}`,
        "version_must_increment",
      );
    });
  });

  it("a sheet in the Trash cannot be edited", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      const id = await insertSheet(tx, a);
      await tx`update public.spec_sheets set deleted_at = now(), updated_by = ${a.id} where id = ${id}`;
      await expectError(
        tx,
        (sp) => sp`update public.spec_sheets set edits = '[{"x":9}]'::jsonb, version = 2, updated_by = ${a.id} where id = ${id}`,
        "sheet_in_trash",
      );
    });
  });

  it("the database, not the client, records who moved a sheet to the Trash and when", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      const b = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      const id = await insertSheet(tx, a);
      await tx`update public.spec_sheets set deleted_at = '2000-01-01', deleted_by = ${b.id}, updated_by = ${a.id} where id = ${id}`;
      const [row] = await tx<{ deleted_by: string; stamped_now: boolean }[]>`
        select deleted_by, deleted_at = now() as stamped_now from public.spec_sheets where id = ${id}`;
      expect(row).toEqual({ deleted_by: a.id, stamped_now: true });
    });
  });

  it("upload, save, trash and restore each write exactly one audit row with the actor", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      const id = await insertSheet(tx, a);
      await tx`select * from public.save_sheet(${id}, 1, null, null, '[{"x":1}]'::jsonb)`;
      await tx`update public.spec_sheets set deleted_at = now(), deleted_by = ${a.id}, updated_by = ${a.id} where id = ${id}`;
      await tx`update public.spec_sheets set deleted_at = null, deleted_by = null, updated_by = ${a.id} where id = ${id}`;
      await actAsOwner(tx);
      const rows = await tx<{ action: string; actor_id: string }[]>`
        select action, actor_id from public.audit_log where target_id = ${id} order by id`;
      expect(rows.map((r) => r.action)).toEqual(["sheet.upload", "sheet.save", "sheet.trash", "sheet.restore"]);
      for (const r of rows) expect(r.actor_id).toBe(a.id);
    });
  });

  it("a sheet can only point at its own files (BR-03)", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      const other = await insertSheet(tx, a);
      await expectError(
        tx,
        (sp) => sp`insert into public.spec_sheets (id, name, source_type, source_path, thumb_path, page_px_w, page_px_h, created_by, updated_by)
                   values (gen_random_uuid(), 'Decoy', 'png', ${`${other}/source.png`}, ${`${other}/thumb.jpg`}, 10, 10, ${a.id}, ${a.id})`,
        "spec_sheets_own_files",
      );
    });
  });

  it("a new sheet starts at version 1 and outside the Trash", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      await expectError(
        tx,
        (sp) => sp`insert into public.spec_sheets (id, name, source_type, source_path, thumb_path, page_px_w, page_px_h, created_by, updated_by, version)
                   select i, 'Planted', 'png', i::text || '/source.png', i::text || '/thumb.jpg', 10, 10, ${a.id}, ${a.id}, 7
                     from gen_random_uuid() as i`,
        "row-level security",
      );
    });
  });
});
