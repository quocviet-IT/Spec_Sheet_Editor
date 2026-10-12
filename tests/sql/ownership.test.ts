import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  actAs, actAsOwner, applyMigration, closeDb, expectError, hasDb, insertObject, insertSheetAsOwner, makeUser, rollback, staffEmail,
  type Tx,
} from "./harness";

afterAll(closeDb);

const MIGRATION = "0004_sheet_ownership.sql";

async function world(tx: Tx) {
  await applyMigration(tx, MIGRATION);
  const a = await makeUser(tx, staffEmail());
  const b = await makeUser(tx, staffEmail());
  const admin = await makeUser(tx, staffEmail(), "admin");
  const aSheet = await insertSheetAsOwner(tx, a, { name: "A's sheet" });
  const bSheet = await insertSheetAsOwner(tx, b, { name: "B's sheet" });
  await insertObject(tx, `${bSheet}/source.png`, b);
  await insertObject(tx, `${bSheet}/thumb.jpg`, b);
  await insertObject(tx, `${aSheet}/thumb.jpg`, a);
  return { a, b, admin, aSheet, bSheet };
}

const visible = async (tx: Tx, ids: string[]) =>
  (await tx<{ id: string }[]>`select id from public.spec_sheets where id = any(${ids}::uuid[])`).map((r) => r.id).sort();

describe.skipIf(!hasDb)("sheet ownership (BR-18)", () => {
  it("Staff read only their own sheets; an Admin reads every sheet", async () => {
    await rollback(async (tx) => {
      const { a, admin, aSheet, bSheet } = await world(tx);
      await actAs(tx, a);
      expect(await visible(tx, [aSheet, bSheet])).toEqual([aSheet]);
      const list = await tx<{ id: string; created_by: string; created_by_name: string }[]>`
        select id, created_by, created_by_name from public.sheet_list where id = any(${[aSheet, bSheet]}::uuid[])`;
      expect(list).toEqual([{ id: aSheet, created_by: a.id, created_by_name: a.email.split("@")[0] }]);
      await actAsOwner(tx);
      await actAs(tx, admin);
      expect(await visible(tx, [aSheet, bSheet])).toEqual([aSheet, bSheet].sort());
    });
  });

  it("Staff cannot save, trash or restore another person's sheet; an Admin can", async () => {
    await rollback(async (tx) => {
      const { a, admin, bSheet } = await world(tx);
      await actAs(tx, a);
      const [save] = await tx<{ saved: boolean }[]>`select saved from public.save_sheet(${bSheet}, 1, null, null, '[]'::jsonb)`;
      expect(save).toBeUndefined(); // the conflict branch also reads through RLS: nothing about B's sheet comes back
      const trashed = await tx`update public.spec_sheets set deleted_at = now(), updated_by = ${a.id} where id = ${bSheet} returning id`;
      expect(trashed.length).toBe(0);
      await actAsOwner(tx);
      await actAs(tx, admin);
      const [ok] = await tx<{ saved: boolean; new_version: number }[]>`select saved, new_version from public.save_sheet(${bSheet}, 1, null, null, '[]'::jsonb)`;
      expect(ok).toEqual({ saved: true, new_version: 2 });
      const moved = await tx`update public.spec_sheets set deleted_at = now(), updated_by = ${admin.id} where id = ${bSheet} returning id`;
      expect(moved.length).toBe(1);
      const back = await tx`update public.spec_sheets set deleted_at = null, updated_by = ${admin.id} where id = ${bSheet} returning id`;
      expect(back.length).toBe(1);
    });
  });

  it("files follow their sheet: Staff read their own, not another person's; an Admin reads all", async () => {
    await rollback(async (tx) => {
      const { a, admin, aSheet, bSheet } = await world(tx);
      const names = async () =>
        (await tx<{ name: string }[]>`select name from storage.objects where bucket_id = 'spec-sheets' and name = any(${[`${aSheet}/thumb.jpg`, `${bSheet}/source.png`, `${bSheet}/thumb.jpg`]})`)
          .map((r) => r.name).sort();
      await actAs(tx, a);
      expect(await names()).toEqual([`${aSheet}/thumb.jpg`]);
      await actAsOwner(tx);
      await actAs(tx, admin);
      expect(await names()).toEqual([`${aSheet}/thumb.jpg`, `${bSheet}/source.png`, `${bSheet}/thumb.jpg`].sort());
    });
  });

  it("an upload in progress (files, no sheet yet) is read by its uploader only", async () => {
    await rollback(async (tx) => {
      const { a, b } = await world(tx);
      const pending = randomUUID();
      await insertObject(tx, `${pending}/source.png`, b);
      const read = async () => (await tx`select 1 from storage.objects where name = ${`${pending}/source.png`}`).length;
      await actAs(tx, b);
      expect(await read()).toBe(1);
      await actAsOwner(tx);
      await actAs(tx, a);
      expect(await read()).toBe(0);
    });
  });

  it("files are added only into a folder that has no sheet yet", async () => {
    await rollback(async (tx) => {
      const { a, bSheet, aSheet } = await world(tx);
      await actAs(tx, a);
      await expectError(tx, (sp) => sp`insert into storage.objects (bucket_id, name, owner, owner_id) values ('spec-sheets', ${`${bSheet}/extra.png`}, ${a.id}, ${a.id})`, "row-level security");
      await expectError(tx, (sp) => sp`insert into storage.objects (bucket_id, name, owner, owner_id) values ('spec-sheets', ${`${aSheet}/extra.png`}, ${a.id}, ${a.id})`, "row-level security");
      const fresh = randomUUID();
      await tx`insert into storage.objects (bucket_id, name, owner, owner_id) values ('spec-sheets', ${`${fresh}/source.png`}, ${a.id}, ${a.id})`;
    });
  });

  it("counts and owners follow the rule; an Admin's counts follow the owner filter", async () => {
    await rollback(async (tx) => {
      const { a, b, admin } = await world(tx);
      await actAs(tx, a);
      const [mine] = await tx<{ live: string }[]>`select live::text from public.sheet_counts(${b.id}::uuid)`;
      expect(mine.live).toBe("0"); // a filter cannot reach past RLS
      const owners = await tx<{ id: string }[]>`select id from public.sheet_owners()`;
      expect(owners.map((o) => o.id)).toEqual([a.id]);
      await actAsOwner(tx);
      await actAs(tx, admin);
      const [ofB] = await tx<{ live: string; trash: string }[]>`select live::text, trash::text from public.sheet_counts(${b.id}::uuid)`;
      expect(ofB).toEqual({ live: "1", trash: "0" });
      const all = await tx<{ id: string; sheets: string }[]>`select id, sheets::text from public.sheet_owners() where id = any(${[a.id, b.id]}::uuid[])`;
      expect(all.map((o) => [o.id, o.sheets]).sort()).toEqual([[a.id, "1"], [b.id, "1"]].sort());
    });
  });

  it("the migration can be applied twice", async () => {
    await rollback(async (tx) => {
      await applyMigration(tx, MIGRATION);
      await applyMigration(tx, MIGRATION);
    });
  });

  it("clients may call the new functions; anonymous visitors may not", async () => {
    await rollback(async (tx) => {
      await applyMigration(tx, MIGRATION);
      const [p] = await tx<Record<string, boolean>[]>`
        select has_function_privilege('authenticated', 'public.sheet_counts(uuid)', 'execute') as counts,
               has_function_privilege('authenticated', 'public.sheet_owners()', 'execute') as owners,
               has_function_privilege('anon', 'public.sheet_owners()', 'execute') as anon_owners,
               has_function_privilege('anon', 'public.sheet_files_readable(text, text)', 'execute') as anon_files`;
      expect(p).toEqual({ counts: true, owners: true, anon_owners: false, anon_files: false });
    });
  });
});
