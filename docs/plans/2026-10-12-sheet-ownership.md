# Sheet Ownership Implementation Plan

> Work through the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each sheet is seen and changed only by the person who uploaded it and by Admins (BR-18). Admins see each
sheet's creator on the list and can filter by creator. Design: `docs/design/2026-10-12-sheet-ownership.md`.

**Architecture:**
- **Migration 0004** sets the rule in the database:
  - row-level security on `spec_sheets`;
  - two `security definer` helpers used by the storage policies;
  - a `sheet_list` view with the creator's id and name;
  - `sheet_counts(p_owner)`;
  - a new `sheet_owners()`.

  It is written to be **re-runnable**: the SQL tests apply its body inside a transaction that is rolled back, so the
  new rules are proven against the live schema before the migration is committed.
- **The app:**
  - The sheet list reads `owner` from the address. It applies `owner` only for Admins.
  - Each row shows the creator to Admins.
  - The editor tells an Admin who uploaded someone else's sheet.

**Tech Stack:** PostgreSQL 17 (Supabase) with RLS and storage policies, Next.js 16.3.8 server components, React 19.2,
Tailwind 4, Zod 4, Vitest 4 (unit and SQL), Playwright 1.63.

## Global Constraints

- Repo is **public**: never commit `.env.local`, real sheets, SO/MO numbers, passwords or keys.
  - Stage files one by one by path. Never use `git add -f`, `git add -A` or `git add .`; git-ignored local scratch files must never be committed.
- File names, commit messages and documents are in English. The only Vietnamese text is interface copy in
  `src/messages/vi.ts`, plus the language's name on the VI/EN switch. End-to-end tests may match Vietnamese UI text in
  regular expressions.
- Commits carry no attribution trailer of any kind and no tool names.
- Every user-facing string goes in both dictionaries, with the same keys and placeholders.
- The database is **production**, and its port 5432 is reachable only from the office network.
  - Nobody runs `npm run db:migrate` or the SQL tests from another network.
  - The SQL tests are written and type-checked; the controller runs them on the office network.
- End-to-end tests run against production. Never start a Playwright run; the controller runs the named specs
  outside working hours, after asking the owner.
- The sheet list must work from a 360 px wide screen (NFR-06), including the Creator select.
- Contrast: text at least 4.5:1, non-text at least 3:1, in light and dark mode. The CSP is unchanged.
- Unit tests: `npx vitest run tests/unit`. Also run `npm run lint`, `npm run typecheck` and `npm run build`.

---

### Task 1: Migration 0004 and its SQL tests

**Files:**
- Create: `supabase/migrations/0004_sheet_ownership.sql`, `tests/sql/ownership.test.ts`
- Modify: `tests/sql/sheet-list.test.ts` (the privilege check names `sheet_counts()`), `tests/sql/harness.ts` (a
  helper)

**Interfaces:**
- Produces for later tasks:
  - view `sheet_list`, gaining `created_by uuid` and `created_by_name text`;
  - function `sheet_counts(p_owner uuid default null) returns table (live bigint, trash bigint)`;
  - function `sheet_owners() returns table (id uuid, name text, sheets bigint)`.

- [ ] **Step 1: Write the migration.** It must be safe to run twice: `drop … if exists`, `create or replace`.

```sql
-- 0004: sheet ownership (BR-18). A sheet, its files and its counts are seen and changed only by the person who
-- uploaded it and by Admins. Written to be re-runnable: tests/sql/ownership.test.ts applies this body inside a
-- transaction that is rolled back, before the migration itself is applied.

-- ===== Rows =====
drop policy if exists sheets_read on public.spec_sheets;
drop policy if exists sheets_update on public.spec_sheets;
create policy sheets_read on public.spec_sheets for select to authenticated
  using ((select public.is_allowed_user()) and (created_by = (select auth.uid()) or (select public.is_admin())));
create policy sheets_update on public.spec_sheets for update to authenticated
  using ((select public.is_allowed_user()) and (created_by = (select auth.uid()) or (select public.is_admin())))
  with check ((select public.is_allowed_user()) and updated_by = (select auth.uid()));
-- sheets_insert is unchanged: it already requires created_by = auth.uid().

-- ===== Files =====
-- A file lives under "<sheet id>/". Whether a sheet exists is read past RLS (security definer), so a folder whose
-- sheet the caller cannot see still counts as taken.
create or replace function public.sheet_files_readable(p_folder text, p_object_owner text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if p_folder is null or p_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  select created_by into v_owner from spec_sheets where id = p_folder::uuid;
  if found then
    return v_owner = auth.uid() or is_admin();
  end if;
  -- no sheet yet: an upload in progress (createSheet lists the folder before it inserts the row), seen by its uploader only
  return p_object_owner is not null and p_object_owner = auth.uid()::text;
end $$;

create or replace function public.sheet_folder_free(p_folder text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_folder is null or p_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return not exists (select 1 from spec_sheets where id = p_folder::uuid);
end $$;

drop policy if exists spec_files_read on storage.objects;
drop policy if exists spec_files_add on storage.objects;
create policy spec_files_read on storage.objects for select to authenticated
  using (bucket_id = 'spec-sheets' and (select public.is_allowed_user())
         and public.sheet_files_readable((storage.foldername(name))[1], owner_id));
-- files are added only into a folder that has no sheet yet (a new upload); never updated or deleted (BR-03)
create policy spec_files_add on storage.objects for insert to authenticated
  with check (bucket_id = 'spec-sheets' and (select public.is_allowed_user())
              and public.sheet_folder_free((storage.foldername(name))[1]));

-- ===== The list =====
-- Columns are only appended, so code reading the old columns keeps working.
create or replace view public.sheet_list with (security_invoker = true) as
  select s.id, s.name, s.source_type, s.thumb_path, s.page_px_w, s.page_px_h,
         jsonb_array_length(s.edits) as edit_count, s.version,
         s.created_at, s.updated_at, coalesce(u.full_name, u.email) as updated_by_name,
         s.deleted_at, coalesce(d.full_name, d.email) as deleted_by_name,
         s.created_by, coalesce(c.full_name, c.email) as created_by_name
    from public.spec_sheets s
    join public.profiles u on u.id = s.updated_by
    left join public.profiles d on d.id = s.deleted_by
    join public.profiles c on c.id = s.created_by;

-- One function only, so PostgREST never sees two candidates; a call without arguments counts everything visible.
drop function if exists public.sheet_counts();
create or replace function public.sheet_counts(p_owner uuid default null) returns table (live bigint, trash bigint)
language sql stable security invoker set search_path = public as $$
  select count(*) filter (where deleted_at is null), count(*) filter (where deleted_at is not null)
    from spec_sheets
   where p_owner is null or created_by = p_owner
$$;

-- The people who own at least one visible sheet, live or in the Trash, for the Admin's Creator filter.
create or replace function public.sheet_owners() returns table (id uuid, name text, sheets bigint)
language sql stable security invoker set search_path = public as $$
  select p.id, coalesce(p.full_name, p.email), count(*)
    from spec_sheets s
    join profiles p on p.id = s.created_by
   group by p.id, p.full_name, p.email
   order by 2, 1
$$;

revoke all on function public.sheet_files_readable(text, text), public.sheet_folder_free(text),
                       public.sheet_counts(uuid), public.sheet_owners() from public, anon;
grant execute on function public.sheet_files_readable(text, text), public.sheet_folder_free(text),
                          public.sheet_counts(uuid), public.sheet_owners() to authenticated;
revoke all on public.sheet_list from anon, authenticated;
grant select on public.sheet_list to authenticated;
```

- [ ] **Step 2: Add a harness helper** to `tests/sql/harness.ts`. It applies the migration body in the current
  transaction, which the caller's `rollback` then undoes:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

/** Applies a migration's body inside the current transaction (the test's rollback undoes it): the rules are proven before they ship. */
export async function applyMigration(tx: Tx, file: string): Promise<void> {
  await tx.unsafe(readFileSync(path.join(process.cwd(), "supabase", "migrations", file), "utf8"));
}

/** A storage object as the storage service would record it, inserted as the table owner. */
export async function insertObject(tx: Tx, name: string, uploader: TestUser): Promise<void> {
  await tx`insert into storage.objects (bucket_id, name, owner, owner_id) values ('spec-sheets', ${name}, ${uploader.id}, ${uploader.id})`;
}
```

- [ ] **Step 3: Write `tests/sql/ownership.test.ts`.** Every test starts with
  `await applyMigration(tx, "0004_sheet_ownership.sql")` as the table owner.
  - Arrange data with `actAsOwner` and `insertSheetAsOwner`; switch with `actAs` to act.
  - Expected results:

```ts
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
```

  Notes for the implementer:
  - Keep the assertions as written. If you add a test, follow the same pattern.
  - Postgres reports a refused insert as "new row violates row-level security policy"; match "row-level security".
  - `storage.objects` has columns `owner uuid` and `owner_id text` on Supabase; the storage service fills both from
    the uploader's token.

- [ ] **Step 4: Update `tests/sql/sheet-list.test.ts`.**
  - In "clients may read the view and call the functions", `public.sheet_counts()` becomes `public.sheet_counts(uuid)`.
    That test now runs after 0004 is live, so begin it with `await applyMigration(tx, "0004_sheet_ownership.sql")`
    as well.
  - Read the file for any test that lists a sheet as someone other than its creator. Today there is none; keep it
    that way.
- [ ] **Step 5: Type-check** (`npm run typecheck`) and run `npx vitest run tests/unit`.
  - Do not run `tests/sql` from this network. `DATABASE_URL` is set but its port is blocked, so the run would hang.
  - State in the report that the SQL tests are written and unrun.
- [ ] **Commit:** `feat(db): each sheet and its files are seen only by its creator and the Admins (migration 0004)`.

### Task 2: The list reads the creator and the owner filter

**Files:**
- Modify:
  - `src/sheets/list-url.ts`
  - `src/sheets/types.ts`
  - `src/sheets/queries.ts`
  - `src/app/(app)/sheets/page.tsx`
  - `src/app/(app)/sheets/sheet-list.tsx`
  - `src/app/(app)/sheets/[id]/page.tsx`
  - `src/app/(app)/sheets/[id]/editor.tsx`
  - the dictionaries
- Test: `tests/unit/sheet-paging.test.ts` (or a new `tests/unit/sheet-owner.test.ts`)

**Interfaces:**
- Consumes (Task 1):
  - `sheet_list.created_by` and `created_by_name`;
  - `rpc("sheet_counts", { p_owner })`;
  - `rpc("sheet_owners")`.
- Produces:
  - `type SheetOwner = "all" | "me" | string` (a uuid);
  - `parseSheetOwner(raw: string | string[] | undefined): SheetOwner`;
  - `sheetListHref({ tab, q, page, size, owner })`, where `owner` is optional and defaults to `"all"`;
  - `SheetRow.createdByName: string`;
  - `fetchSheetPageNumbered(tab, query, page, size, ownerId: string | null)`;
  - `fetchCounts(ownerId: string | null)`;
  - `fetchSheetOwners(): Promise<{ id: string; name: string; sheets: number }[]>`;
  - `EditorSheet.uploadedBy: string | null`.

- [ ] **Step 1: Unit tests first.**

```ts
import { describe, expect, it } from "vitest";
import { parseSheetOwner, sheetListHref } from "@/sheets/list-url";

describe("parseSheetOwner", () => {
  it("reads all, me and a person's id, and falls back to all", () => {
    expect(parseSheetOwner(undefined)).toBe("all");
    expect(parseSheetOwner("me")).toBe("me");
    expect(parseSheetOwner("6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f")).toBe("6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f");
    expect(parseSheetOwner("6F1C2D3E-4A5B-4C6D-8E7F-9A0B1C2D3E4F")).toBe("6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f");
    expect(parseSheetOwner(["me", "x"])).toBe("me"); // an array takes its first element, as parseSheetTab does
    expect(parseSheetOwner("")).toBe("all");
    expect(parseSheetOwner("all")).toBe("all");
    expect(parseSheetOwner("ME")).toBe("all");
    expect(parseSheetOwner("6f1c2d3e")).toBe("all");
    expect(parseSheetOwner("'; drop table x")).toBe("all");
  });
});

describe("sheetListHref with an owner", () => {
  it("leaves all out and keeps me or an id", () => {
    expect(sheetListHref({ tab: "live", q: "", page: 1, size: 25 })).toBe("/sheets");
    expect(sheetListHref({ tab: "live", q: "", page: 1, size: 25, owner: "all" })).toBe("/sheets");
    expect(sheetListHref({ tab: "trash", q: "ring", page: 2, size: 25, owner: "me" })).toBe("/sheets?tab=trash&q=ring&owner=me&page=2");
  });
});
```

  The rule: anything that is not `me` or a uuid gives `all`.
- [ ] **Step 2: `list-url.ts`.**
  - Add `parseSheetOwner`, lower-casing a uuid.
  - `sheetListHref` gains an optional `owner` param, placed after `q` and before `page`. It is left out when `all`.
- [ ] **Step 3: `queries.ts`.**
  - `fetchSheetPageNumbered` gains `ownerId: string | null`. When set, both the count and the range read add
    `.eq("created_by", ownerId)`.
  - The select adds `created_by_name`, and the `SheetRow` mapping adds `createdByName`.
  - `fetchCounts(ownerId)` calls `rpc("sheet_counts", ownerId ? { p_owner: ownerId } : {})`.
  - New `fetchSheetOwners()` calls `rpc("sheet_owners")` and maps `sheets` to a number.
  - `fetchEditorSheet` reads the creator in the same query, with an embedded select that names the foreign key
    (three foreign keys point at `profiles`):
    `created_by, creator:profiles!spec_sheets_created_by_fkey(full_name, email)`.
    It returns `createdBy` and `createdByName` (`full_name ?? email`); the page derives `uploadedBy` from them
    (Step 6).
  - The pagination's size form takes its hidden fields from `hrefFor`, so `owner` survives a size change once
    `hrefFor` carries it. Check this.
- [ ] **Step 4: `sheets/page.tsx`.**
  - Keep `const me = await requireUser("/sheets")` and set `const isAdmin = me.role === "admin"`.
  - `owner = isAdmin ? parseSheetOwner(params.owner) : "all"`.
  - `ownerId = owner === "me" ? me.id : owner === "all" ? null : owner`.
  - Fetch the page, the counts (with `ownerId`) and, for an Admin only, the owners, in the existing `Promise.all`.
  - Pass `owner`, `owners` (an empty array for Staff) and `isAdmin` to `SheetList`.
- [ ] **Step 5: `sheet-list.tsx`.**
  - `hrefFor`, the tab links and the debounced search all carry `owner`.
  - **For an Admin:**
    - A `<select>` labelled **Creator** sits in the toolbar after the search box, in DOM order and visually. Its
      options:
      - **All** (`all`);
      - **My sheets** (`me`);
      - then each owner as `{name} ({n})`, using the existing number formatting style.
    - Changing the select does `router.push(sheetListHref({ tab, q: current query, page: 1, size, owner }))` inside
      the existing `startTransition`.
    - A malformed id has already fallen back to `all` on the server. A well-formed id that matches nobody lists
      nothing; the select then shows All, and no extra option is added for it.
    - Each row's metadata line shows `by {name}` (`sheets.by`) after the file label, on both tabs.
  - For Staff nothing changes.
  - At 360 px the select wraps under the search box without horizontal scroll, and its control is at least
    24 × 24 px.
- [ ] **Step 6: The editor.**
  - `[id]/page.tsx` computes `uploadedBy = sheet.createdBy !== me.id ? creatorName : null` and passes it in the
    sheet.
  - `editor.tsx` renders, under the title row, a muted line `Uploaded by {name}` (`editor.uploadedBy`) when
    `uploadedBy` is set.
  - Only an Admin can reach another person's sheet, so the line is Admin-only by construction.
- [ ] **Step 7: Dictionaries** (both, same keys):
  - `sheets.by`: "by {name}";
  - `sheets.owner`:
    - `label`: "Creator";
    - `all`: "All";
    - `mine`: "My sheets";
    - `option`: "{name} ({n})";
  - `editor.uploadedBy`: "Uploaded by {name}".
- [ ] **Step 8:** Run `npx vitest run tests/unit`, `npm run lint`, `npm run typecheck` and `npm run build`.
- [ ] **Commit:** `feat(sheets): Admins see who uploaded each sheet and filter the list by creator`.

### Task 3: End-to-end tests, guide copy and documents

**Files:**
- Create: `e2e/ownership.spec.ts`
- Modify:
  - `e2e/editor.spec.ts` (TC-38)
  - `src/messages/en.ts`, `src/messages/vi.ts` (guide copy)
  - `docs/design/spec-sheet-editor-design.md`
  - `docs/testing/test-case-status.md`
  - `README.md`

- [ ] **Step 1: `e2e/ownership.spec.ts`.** It seeds with the service-role client (`admin()` from
  `e2e/support/db.ts`), as `e2e/list.spec.ts` does, and cleans up in `afterEach` with `deleteSheetsOf` for each
  owner.
  - **"BR-18 Staff see only their own sheets":**
    - Seed one sheet for e2e-staff and one for e2e-staff-b, sharing a random prefix.
    - As e2e-staff-b (`e2e/.auth/staff-b.json`), search the prefix. The footer reads "Showing 1–1 of 1", and the
      only row is staff-b's.
    - Open staff's sheet by `/sheets/<id>`: the response status is 404, and the sheet's name is nowhere on the page.
  - **"BR-18 an Admin sees every sheet with its creator and filters by creator":**
    - As e2e-admin (`e2e/.auth/admin.json`), search the prefix. There are two rows, each with "by E2E Staff" or
      "by E2E Staff B".
    - Choose the Creator option for E2E Staff B. The address gains `owner=<id>`, there is one row, and the Sheets
      tab count matches.
    - Open staff's sheet: the editor shows "Uploaded by E2E Staff".
  - Wait for the filtered list with `searchSheets` from `e2e/support/sheets.ts`, extended with an optional
    `total`.
- [ ] **Step 2: TC-38** becomes "the owner and an Admin edit the same sheet".
  - The second context uses `e2e/.auth/admin.json` instead of `staff-b.json`.
  - The conflict text still names "E2E Staff", who saved first.
  - Keep every other assertion.
- [ ] **Step 3: Guide copy, in both dictionaries.**
  - `guide.sections.find.lead`: the list holds the sheets you uploaded; an Admin sees everyone's and can filter by
    Creator.
  - `guide.sections.save.lead`: drop "a saved sheet is shared: everyone with access sees the same latest version".
    Say that only you and the Admins see your sheets, and that the latest saved version is what you and they open.
- [ ] **Step 4: `docs/design/spec-sheet-editor-design.md`.**
  - BR-10's rationale becomes: the owner can have the sheet open twice, and an Admin can edit a sheet while its
    owner does.
  - Add BR-18 with the exact text from `docs/design/2026-10-12-sheet-ownership.md`.
  - F-03 and UC-02: the list holds the caller's own sheets; an Admin extension covers the creator on each row and
    the Creator filter in the address (`owner`).
  - UC-08: saving follows BR-18.
  - Test-case table: TC-38's new wording; add rows for the two new e2e tests and the SQL ownership tests.
- [ ] **Step 5:**
  - `docs/testing/test-case-status.md`: the new cases, as "written, not yet run".
  - `README.md`: one line under the features: "Each sheet is seen by the person who uploaded it and by Admins."
- [ ] **Step 6:** Run `npm run typecheck`, `npx vitest run tests/unit` and `npm run lint`. Do not run Playwright.
- [ ] **Commit:** `test(sheets): ownership end-to-end tests, guide copy and documents`.

## After the tasks (controller)

1. Merge `feat/logo-and-sheet-paging` first. This branch is stacked on it.
2. Office network, outside working hours (the tests take short locks on `spec_sheets` and `storage.objects`):
   - `npx vitest run tests/sql`;
   - then `npm run db:migrate` (0004);
   - then `npx vitest run tests/sql` again, now against the live 0004.
3. The owner tells the staff, then merges this branch; Vercel deploys it.
4. Outside working hours:
   ```
   timeout 2700 npx playwright test e2e/ownership.spec.ts e2e/editor.spec.ts e2e/list.spec.ts e2e/a11y.spec.ts e2e/admin.spec.ts
   ```
