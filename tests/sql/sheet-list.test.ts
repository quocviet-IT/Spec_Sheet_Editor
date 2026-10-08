import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  actAs, actAsOwner, closeDb, hasDb, insertSheetAsOwner, makePasswordUser, makeUser, rollback, staffEmail, type Tx,
} from "./harness";

afterAll(closeDb);

type Row = { id: string; name: string; edit_count: number; updated_by_name: string; deleted_by_name: string | null };

async function page(tx: Tx, trash: boolean, query: string | null, after: { time: string; id: string } | null, limit: number) {
  return tx<Row[]>`select id, name, edit_count, updated_by_name, deleted_by_name
                     from public.list_sheets(${trash}, ${query}, ${after?.time ?? null}, ${after?.id ?? null}, ${limit})`;
}

describe.skipIf(!hasDb)("sheet list (UC-02, UC-11)", () => {
  it("lists live sheets newest change first, with the edit count and the last editor's name", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      const older = await insertSheetAsOwner(tx, staff, { name: "Older", updatedAt: new Date("2026-10-01T08:00:00Z") });
      const newer = await insertSheetAsOwner(tx, staff, { name: "Newer", updatedAt: new Date("2026-10-02T08:00:00Z"), edits: 3 });
      await actAs(tx, staff);
      const rows = (await page(tx, false, null, null, 50)).filter((r) => r.id === older || r.id === newer);
      expect(rows.map((r) => r.name)).toEqual(["Newer", "Older"]);
      expect(rows[0].edit_count).toBe(3);
      expect(rows[0].updated_by_name).toBe(staff.email.split("@")[0]);
    });
  });

  it("pages by (time, id) without gaps or repeats, even when times are equal", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      const same = new Date("2026-10-03T08:00:00Z");
      const ids = [
        await insertSheetAsOwner(tx, staff, { name: "P1", updatedAt: same }),
        await insertSheetAsOwner(tx, staff, { name: "P2", updatedAt: same }),
        await insertSheetAsOwner(tx, staff, { name: "P3", updatedAt: same }),
      ];
      await actAs(tx, staff);
      const all = (await page(tx, false, "P", null, 50)).map((r) => r.id);
      expect(all.sort()).toEqual([...ids].sort());
      const first = await page(tx, false, "P", null, 2);
      const [last] = await tx<{ updated_at: string }[]>`select updated_at::text from public.spec_sheets where id = ${first[1].id}`;
      const second = await page(tx, false, "P", { time: last.updated_at, id: first[1].id }, 2);
      expect([...first, ...second].map((r) => r.id)).toEqual((await page(tx, false, "P", null, 50)).map((r) => r.id));
      expect(second.length).toBe(1);
    });
  });

  it("search is partial and case-insensitive, and % and _ are matched literally", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      const tag = randomUUID().slice(0, 8);
      await insertSheetAsOwner(tx, staff, { name: `Emerald RING ${tag}` });
      await insertSheetAsOwner(tx, staff, { name: `Sale 50% ${tag}` });
      await insertSheetAsOwner(tx, staff, { name: `Sale 500 ${tag}` });
      await insertSheetAsOwner(tx, staff, { name: `a_b ${tag}` });
      await insertSheetAsOwner(tx, staff, { name: `axb ${tag}` });
      await actAs(tx, staff);
      expect((await page(tx, false, `ring ${tag}`, null, 50)).map((r) => r.name)).toEqual([`Emerald RING ${tag}`]);
      expect((await page(tx, false, `50% ${tag}`, null, 50)).map((r) => r.name)).toEqual([`Sale 50% ${tag}`]);
      expect((await page(tx, false, `a_b ${tag}`, null, 50)).map((r) => r.name)).toEqual([`a_b ${tag}`]);
    });
  });

  it("the Trash tab shows only trashed sheets, newest deletion first, with who deleted them", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      const kept = await insertSheetAsOwner(tx, staff, { name: "Kept" });
      const gone = await insertSheetAsOwner(tx, staff, { name: "Gone" });
      await actAs(tx, staff);
      await tx`update public.spec_sheets set deleted_at = now(), updated_by = ${staff.id} where id = ${gone}`;
      const trash = (await page(tx, true, null, null, 50)).filter((r) => r.id === kept || r.id === gone);
      expect(trash.map((r) => r.name)).toEqual(["Gone"]);
      expect(trash[0].deleted_by_name).toBe(staff.email.split("@")[0]);
      const live = (await page(tx, false, null, null, 50)).filter((r) => r.id === kept || r.id === gone);
      expect(live.map((r) => r.name)).toEqual(["Kept"]);
      const [c] = await tx<{ live: string; trash: string }[]>`select live::text, trash::text from public.sheet_counts()`;
      expect(Number(c.trash)).toBeGreaterThanOrEqual(1);
    });
  });

  it("an account that may not enter sees no rows and zero counts", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await insertSheetAsOwner(tx, staff, { name: "Secret" });
      const outsider = await makeUser(tx, `x-${randomUUID().slice(0, 8)}@gmail.com`);
      await actAs(tx, outsider);
      expect((await page(tx, false, null, null, 50)).length).toBe(0);
      const [c] = await tx<{ live: string; trash: string }[]>`select live::text, trash::text from public.sheet_counts()`;
      expect(c).toEqual({ live: "0", trash: "0" });
      await actAsOwner(tx);
      const fresh = await makePasswordUser(tx, staffEmail(), { mustChange: true });
      await actAs(tx, fresh, "email");
      expect((await page(tx, false, null, null, 50)).length).toBe(0);
    });
  });

  it("a page holds at most 200 rows and at least 1", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await insertSheetAsOwner(tx, staff, { name: "Only" });
      await actAs(tx, staff);
      expect((await page(tx, false, null, null, 0)).length).toBe(1);
    });
  });

  it("clients may read the view and call the functions; anonymous visitors may not", async () => {
    await rollback(async (tx) => {
      const [p] = await tx<Record<string, boolean>[]>`
        select has_table_privilege('authenticated', 'public.sheet_list', 'select') as view_select,
               has_function_privilege('authenticated', 'public.list_sheets(boolean, text, timestamptz, uuid, int)', 'execute') as list,
               has_function_privilege('authenticated', 'public.sheet_counts()', 'execute') as counts,
               has_table_privilege('anon', 'public.sheet_list', 'select') as anon_view,
               has_function_privilege('anon', 'public.list_sheets(boolean, text, timestamptz, uuid, int)', 'execute') as anon_list`;
      expect(p).toEqual({ view_select: true, list: true, counts: true, anon_view: false, anon_list: false });
    });
  });
});
