# Password Sign-in Implementation Plan

> Work through the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People sign in with their company email and a password that an Admin issues in the app; the
first sign-in forces them to set their own password. Google sign-in stays in the code, switched off,
to run side by side later.

**Architecture:** Supabase Auth's email provider holds the passwords; the database decides who may
enter. Migration `0002` adds two profile flags (`password_account`, `must_change_password`), a
client-invisible table that remembers the hash of each one-time password, and three security-definer
functions (register an account, mark a reset, finish a password change). `is_allowed_user()` admits a
Google session under the permitted lists (unchanged) or a session whose profile an Admin created, and
refuses anyone still holding a one-time password. Server actions use the secret key only to create a
sign-in account or set a one-time password; everything else runs in the Admin's or the person's own
session so RLS and the audit log see the real actor.

**Tech Stack:** Next.js 16.3.8 (server actions, `useActionState`), React 19.2, Supabase Auth
(`@supabase/ssr`, `@supabase/supabase-js` admin API), Postgres 17 functions, Zod 4, Vitest 4.

**Decisions (owner, 2026-10-08):** the sign-in name is the person's email; an Admin creates accounts
in the app (Admin → Users); a one-time password must be replaced at the first sign-in; Google and
password sign-in will run side by side once Google is switched on.

## Global Constraints

- Repo is **public**: never commit `.env.local`, real sheets, SO/MO numbers, passwords or keys. Stage files one by one.
- File names, commit messages and documents are in English. The only Vietnamese text in the repository is interface copy: `src/messages/vi.ts` and the language's own name ("Tiếng Việt") on the VI/EN switch.
- Commits carry no attribution trailer of any kind (no Co-Authored-By, no tool or AI mentions).
- Code, identifiers and comments in English.
- Every user-facing string comes from `src/messages/vi.ts` + `src/messages/en.ts`; both must keep exactly the same keys (`tests/unit/messages.test.ts`).
- Every data-bearing page, server action and route handler calls `requireUser()` / `requireAdmin()` itself; the sign-in and change-password actions are the only exceptions (they run before access is granted) and check the session themselves.
- The secret-key client (`createSupabaseAdmin()`) is used only to: log rejected sign-ins, create a sign-in account, set a one-time password, delete a sign-in account whose registration failed, and the uses already listed in `src/lib/supabase/admin.ts`.
- Applied migrations are never edited; fix forward with the next number. `DATABASE_URL` points at the development project only.
- Passwords: at least 10 characters (`MIN_PASSWORD_LENGTH`). One-time passwords are generated on the server (`generateTempPassword()`), shown once to the Admin, never logged and never stored by the app.
- The access rule lives in the database (`is_allowed_user()`); page guards only decide what to show.

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0002_password_sign_in.sql` | Profile flags, `password_handovers`, revised `is_allowed_user()` / `my_access_status()`, `admin_register_password_account`, `admin_mark_password_reset`, `finish_password_change`, grants |
| `tests/sql/harness.ts` | `actAs(..., provider)`, `makeSignInAccount`, `makePasswordUser` helpers |
| `tests/sql/password.test.ts` | SQL tests for password accounts |
| `tests/sql/access.test.ts` | One test renamed (behaviour unchanged) |
| `src/auth/password.ts` | `MIN_PASSWORD_LENGTH`, `generateTempPassword()`, `checkNewPassword()` (pure) |
| `src/auth/errors.ts` | Supabase Auth error → reason codes (pure) |
| `src/auth/access.ts` | `must_change_password` status, `change_password` decision, `Profile.passwordAccount` |
| `src/auth/session.ts` | Reads `password_account`; redirects to `/account/password` |
| `src/lib/env.ts` | `GOOGLE_SIGN_IN` flag (`on` / `off`, default `off`) |
| `src/messages/vi.ts`, `src/messages/en.ts` | New interface copy |
| `src/auth/denied.ts` | `recordDenied()` — writes `auth.denied` (shared by both sign-in paths) |
| `src/auth/actions.ts` | `signInWithPassword`, `changePassword` (plus existing Google and sign-out actions) |
| `src/app/login/page.tsx`, `src/app/login/password-form.tsx` | Sign-in screen: email + password; Google button only when `GOOGLE_SIGN_IN=on` |
| `src/app/auth/callback/route.ts` | Uses `recordDenied()` |
| `src/app/account/password/page.tsx`, `src/app/account/password/form.tsx` | Set / change password screen |
| `src/ui/app-header.tsx` | "Change password" link for password accounts |
| `src/admin/user-actions.ts` | `createPasswordUser`, `resetPassword` server actions |
| `src/app/(app)/admin/users/*` | Admin → Users: list, add user, issue a new one-time password |
| `src/app/(app)/admin/page.tsx` | Links the Users area |
| `src/lib/supabase/admin.ts` | Comment lists the new allowed uses |
| `scripts/create-admin.mts`, `package.json` | `npm run admin:create` — the first Admin |
| `README.md`, `.env.example`, `docs/design/*`, `docs/plans/2026-10-07-spec-sheet-editor-roadmap.md` | Setup and design updated for password sign-in |

---

### Task 1: Database — password accounts (migration 0002 and SQL tests)

**Files:**
- Create: `supabase/migrations/0002_password_sign_in.sql`
- Create: `tests/sql/password.test.ts`
- Modify: `tests/sql/harness.ts` (`actAs` gains a `provider` argument; two new helpers)
- Modify: `tests/sql/access.test.ts` (rename one test)

**Interfaces:**
- Produces (SQL, callable by `authenticated`):
  - `public.admin_register_password_account(p_user uuid, p_full_name text, p_role text) returns void` — errors: `forbidden`, `bad_role`, `bad_name`, `user_not_found`, `not_password_account`, `stale_account`, `already_registered`
  - `public.admin_mark_password_reset(p_user uuid) returns void` — errors: `forbidden`, `self_reset`, `not_password_account`
  - `public.finish_password_change() returns void` — errors: `not_password_account`, `forbidden`, `password_unchanged`
  - `public.my_access_status()` may now also return `'must_change_password'`
  - `public.profiles` gains `password_account boolean not null default false`, `must_change_password boolean not null default false`
- Produces (tests): `actAs(tx, user, provider?: "google" | "email")`, `makeSignInAccount(tx, email, opts)`, `makePasswordUser(tx, email, opts)`

- [ ] **Step 1: Harness helpers**

In `tests/sql/harness.ts`, replace `actAs` and add the two helpers after `makeUser`:

```ts
/** Switches the transaction to the `authenticated` role with this user's session JWT claims. */
export async function actAs(tx: Tx, user: { id: string; email: string }, provider: "google" | "email" = "google"): Promise<void> {
  const claims = { sub: user.id, email: user.email, role: "authenticated", app_metadata: { provider, providers: [provider] } };
  await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
  await tx`set local role authenticated`;
}

/** A Supabase Auth account only (no profile), as auth.admin.createUser leaves it. */
export async function makeSignInAccount(
  tx: Tx,
  email: string,
  opts: { provider?: "email" | "google"; hash?: string; createdAt?: Date } = {},
): Promise<TestUser & { hash: string }> {
  const id = randomUUID();
  const provider = opts.provider ?? "email";
  const hash = opts.hash ?? `test-hash-${id}`;
  await tx`insert into auth.users (id, email, aud, role, encrypted_password, raw_app_meta_data, created_at)
           values (${id}, ${email}, 'authenticated', 'authenticated', ${hash},
                   ${tx.json({ provider, providers: [provider] })}, ${opts.createdAt ?? new Date()})`;
  return { id, email, hash };
}

/** A password account an Admin created; `mustChange` means the one-time password is still in use. */
export async function makePasswordUser(
  tx: Tx,
  email: string,
  opts: { role?: "user" | "admin"; mustChange?: boolean } = {},
): Promise<TestUser & { hash: string }> {
  const account = await makeSignInAccount(tx, email);
  await tx`insert into public.profiles (id, email, full_name, role, password_account, must_change_password)
           values (${account.id}, ${email}, ${email.split("@")[0]}, ${opts.role ?? "user"}, true, ${opts.mustChange ?? false})`;
  if (opts.mustChange) {
    await tx`insert into public.password_handovers (user_id, temp_hash) values (${account.id}, ${account.hash})`;
  }
  return account;
}
```

- [ ] **Step 2: Write the failing SQL tests**

Create `tests/sql/password.test.ts`:

```ts
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
      const left = await tx`select 1 from public.password_handovers where user_id = ${member.id}`;
      expect(left.length).toBe(0);
      const [audit] = await tx<{ actor_id: string }[]>`
        select actor_id from public.audit_log where action = 'user.password_changed' and target_id = ${member.id}`;
      expect(audit.actor_id).toBe(member.id);
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
      const [h] = await tx<{ temp_hash: string; issued_by: string }[]>`
        select temp_hash, issued_by from public.password_handovers where user_id = ${account.id}`;
      expect(h).toEqual({ temp_hash: account.hash, issued_by: admin.id });
      const [a] = await tx<{ actor_id: string; detail: { email: string; role: string } }[]>`
        select actor_id, detail from public.audit_log where action = 'user.create' and target_id = ${account.id}`;
      expect(a.actor_id).toBe(admin.id);
      expect(a.detail).toMatchObject({ email: "new.person@ctyhp.vn", role: "user" });
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
      const [h] = await tx<{ temp_hash: string }[]>`select temp_hash from public.password_handovers where user_id = ${member.id}`;
      expect(h.temp_hash).toBe("new-one-time-hash");
      expect((await tx`select 1 from auth.sessions where user_id = ${member.id}`).length).toBe(0);
      const [a] = await tx<{ actor_id: string }[]>`
        select actor_id from public.audit_log where action = 'user.password_reset' and target_id = ${member.id}`;
      expect(a.actor_id).toBe(admin.id);
    });
  });

  it("a reset is refused for Staff, for the Admin's own account and for a Google account", async () => {
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
        select has_table_privilege('authenticated', 'public.password_handovers', 'select') as handover_select,
               has_table_privilege('anon', 'public.password_handovers', 'select')          as anon_select,
               has_function_privilege('anon', 'public.finish_password_change()', 'execute') as anon_finish`;
      expect(Object.values(p).every((v) => v === false)).toBe(true);
      const [q] = await tx<Record<string, boolean>[]>`
        select has_function_privilege('authenticated', 'public.finish_password_change()', 'execute') as finish,
               has_function_privilege('authenticated', 'public.admin_mark_password_reset(uuid)', 'execute') as reset,
               has_function_privilege('authenticated', 'public.admin_register_password_account(uuid, text, text)', 'execute') as register`;
      expect(Object.values(q).every((v) => v === true)).toBe(true);
      const member = await makePasswordUser(tx, staffEmail(), { mustChange: true });
      await actAs(tx, member, "email");
      await expectError(tx, (sp) => sp`update public.profiles set must_change_password = false where id = ${member.id}`, "permission denied");
    });
  });
});
```

In `tests/sql/access.test.ts`, rename the test `"an email-and-password session on a permitted domain is refused: Google sign-in only"` to
`"an email-and-password session is refused unless an Admin created the account"`; its body stays the same
(the profile `makeUser` creates is not a password account).

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx vitest run tests/sql/password.test.ts`
Expected: FAIL — e.g. `function public.finish_password_change() does not exist` / `column "password_account" … does not exist`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/0002_password_sign_in.sql`:

```sql
-- 0002: password sign-in for accounts an Admin creates in the app; Google sign-in stays for later.
-- Decisions (2026-10-08): the sign-in name is the person's email; an Admin creates the account and
-- hands over a one-time password; the person must set their own password before anything else;
-- Google and password sign-in will run side by side once Google is switched on.

-- ===== Profiles: how the account signs in =====
alter table public.profiles
  add column password_account     boolean not null default false,
  add column must_change_password boolean not null default false;

-- The password hash an account had when an Admin issued its one-time password. Setting a new password
-- changes the hash, which is how the database knows the one-time password is no longer in use.
-- No policies and no client grants: only the functions below read or write it.
create table public.password_handovers (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  temp_hash text not null,
  issued_by uuid references public.profiles (id),
  issued_at timestamptz not null default now()
);
alter table public.password_handovers enable row level security;
revoke all on public.password_handovers from anon, authenticated;

-- ===== Access checks (BR-08), revised =====
-- Google: the address is proven by Google; the permitted-domain and permitted-email lists decide.
-- Password: only an account an Admin created (password_account) may enter. A self-made email account,
-- should sign-ups ever be switched on, has no such profile and is refused.
-- Either way the account must not be suspended or still be on a one-time password.
create or replace function public.is_allowed_user() returns boolean
language sql stable security definer set search_path = public as $$
  with me as (
    select lower(coalesce(auth.jwt() ->> 'email', '')) as email,
           coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') as provider
  )
  select not exists (select 1 from profiles p
                      where p.id = auth.uid() and (p.status = 'suspended' or p.must_change_password))
     and (
       (me.provider = 'google'
        and me.email ~ '^[^@\s]+@[^@\s]+$'
        and (exists (select 1 from allowed_domains d where d.domain = split_part(me.email, '@', 2))
             or exists (select 1 from allowed_emails e where e.email = me.email)))
       or exists (select 1 from profiles p where p.id = auth.uid() and p.password_account)
     )
  from me
$$;

create or replace function public.my_access_status() returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'signed_out'
    when exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'suspended') then 'suspended'
    when exists (select 1 from profiles p where p.id = auth.uid() and p.must_change_password) then 'must_change_password'
    when not public.is_allowed_user() then 'not_permitted'
    else 'ok'
  end
$$;

-- ===== Password accounts =====
-- The app first creates the sign-in account with the secret key (auth.admin.createUser), then calls
-- this in the Admin's own session, so the audit row names the Admin.
create function public.admin_register_password_account(p_user uuid, p_full_name text, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user auth.users%rowtype;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_role is null or p_role not in ('user', 'admin') then raise exception 'bad_role'; end if;
  if coalesce(btrim(p_full_name), '') = '' or length(btrim(p_full_name)) > 120 then raise exception 'bad_name'; end if;
  select * into v_user from auth.users where id = p_user;
  if not found then raise exception 'user_not_found'; end if;
  if coalesce(v_user.raw_app_meta_data ->> 'provider', '') <> 'email'
     or coalesce(v_user.encrypted_password, '') = '' then
    raise exception 'not_password_account';
  end if;
  -- only an account the app has just created; never adopt an older sign-up
  if v_user.created_at is null or v_user.created_at < now() - interval '10 minutes' then
    raise exception 'stale_account';
  end if;
  if exists (select 1 from profiles where id = p_user) then raise exception 'already_registered'; end if;
  insert into profiles (id, email, full_name, role, password_account, must_change_password)
  values (p_user, lower(v_user.email), btrim(p_full_name), p_role, true, true);
  insert into password_handovers (user_id, temp_hash, issued_by)
  values (p_user, v_user.encrypted_password, auth.uid());
  perform _audit('user.create', 'user', p_user::text,
                 jsonb_build_object('email', lower(v_user.email), 'role', p_role, 'sign_in', 'password'));
end $$;

-- The app first sets the new one-time password with the secret key (auth.admin.updateUserById), then
-- calls this in the Admin's own session.
create function public.admin_mark_password_reset(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_hash  text;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'self_reset'; end if;
  select p.email into v_email from profiles p where p.id = p_user and p.password_account;
  if not found then raise exception 'not_password_account'; end if;
  select encrypted_password into v_hash from auth.users where id = p_user;
  update profiles set must_change_password = true, updated_at = now() where id = p_user;
  insert into password_handovers (user_id, temp_hash, issued_by)
  values (p_user, v_hash, auth.uid())
  on conflict (user_id) do update
     set temp_hash = excluded.temp_hash, issued_by = excluded.issued_by, issued_at = now();
  -- Whoever holds a session for this account must sign in again with the new one-time password.
  delete from auth.sessions where user_id = p_user;
  perform _audit('user.password_reset', 'user', p_user::text, jsonb_build_object('email', v_email));
end $$;

-- The person calls this after setting a new password (auth.updateUser). The "must change" flag clears
-- only if the password really changed, which the database sees as a different hash.
create function public.finish_password_change() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_hash    text;
  v_temp    text;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found or not v_profile.password_account then raise exception 'not_password_account'; end if;
  if v_profile.status = 'suspended' then raise exception 'forbidden'; end if;
  if v_profile.must_change_password then
    select encrypted_password into v_hash from auth.users where id = auth.uid();
    select temp_hash into v_temp from password_handovers where user_id = auth.uid();
    if v_hash is not distinct from v_temp then raise exception 'password_unchanged'; end if;
    update profiles set must_change_password = false, updated_at = now() where id = auth.uid();
    delete from password_handovers where user_id = auth.uid();
  end if;
  perform _audit('user.password_changed', 'user', auth.uid()::text, '{}');
end $$;

grant execute on function
  public.admin_register_password_account(uuid, text, text),
  public.admin_mark_password_reset(uuid),
  public.finish_password_change()
  to authenticated;

-- First Admin: `npm run admin:create -- <email> "<Full name>"` (README, Setup). Later accounts are
-- created in the app: Admin → Users.
```

- [ ] **Step 5: Apply it to the development project and run the tests**

Run: `npm run db:migrate`
Expected: `applied 0002_password_sign_in` then `1 migration(s) applied`.

Run: `npx vitest run tests/sql`
Expected: PASS — 5 files, 38 tests (30 before + 8 new).

If a later review asks for a change to `0002` before it is merged, undo it on the development project
only (never anywhere else), then edit and re-apply:

```sql
begin;
drop function if exists public.finish_password_change();
drop function if exists public.admin_mark_password_reset(uuid);
drop function if exists public.admin_register_password_account(uuid, text, text);
drop table if exists public.password_handovers;
-- then re-run the two `create function public.is_allowed_user()` / `public.my_access_status()`
-- statements from 0001_init.sql as `create or replace function`
alter table public.profiles drop column if exists must_change_password, drop column if exists password_account;
delete from public.schema_migrations where version = '0002_password_sign_in';
commit;
```

- [ ] **Step 6: Run the whole suite, then commit**

Run: `npm test` — Expected: all files pass.

```bash
git add supabase/migrations/0002_password_sign_in.sql
git add tests/sql/harness.ts
git add tests/sql/password.test.ts
git add tests/sql/access.test.ts
git commit -m "feat(db): password accounts an Admin creates, with a one-time password the person must replace"
```

---

### Task 2: Pure building blocks — passwords, error codes, access decision, flag, copy

**Files:**
- Create: `src/auth/password.ts`, `src/auth/errors.ts`
- Create: `tests/unit/password.test.ts`, `tests/unit/auth-errors.test.ts`
- Modify: `src/auth/access.ts`, `src/auth/session.ts` (read `password_account`), `tests/unit/access.test.ts`
- Modify: `src/lib/env.ts`, `tests/unit/env.test.ts`
- Modify: `src/messages/vi.ts`, `src/messages/en.ts`

**Interfaces:**
- Produces:
  - `MIN_PASSWORD_LENGTH = 10`
  - `generateTempPassword(randomBytes?: (n: number) => Uint8Array): string` — `xxxx-xxxx-xxxx`, 12 characters from `abcdefghjkmnpqrstuvwxyz23456789`, at least one letter and one digit
  - `type NewPasswordError = "too_short" | "mismatch"`; `checkNewPassword(password: string, confirm: string): NewPasswordError | null`
  - `type SignInError = "invalid" | "rate_limited" | "unknown"`; `signInErrorCode(error: AuthErrorLike | null): SignInError | null`
  - `type PasswordUpdateError = "same" | "weak" | "reauth" | "unknown"`; `passwordUpdateErrorCode(error: AuthErrorLike | null): PasswordUpdateError | null`
  - `type CreateUserError = "email_taken" | "invalid_email" | "weak" | "unknown"`; `createUserErrorCode(error: AuthErrorLike | null): CreateUserError | null`
  - `type AuthErrorLike = { code?: string; status?: number }`
  - `AccessStatus` gains `"must_change_password"`; `Decision` gains `{ kind: "change_password" }`; `Profile` gains `passwordAccount: boolean`
  - `Env` gains `GOOGLE_SIGN_IN: "on" | "off"` (default `"off"`)
  - Message keys listed in Step 7

- [ ] **Step 1: Failing unit tests for passwords and error codes**

Create `tests/unit/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkNewPassword, generateTempPassword, MIN_PASSWORD_LENGTH } from "@/auth/password";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

describe("generateTempPassword", () => {
  it("gives three groups of four unambiguous characters with a letter and a digit", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword();
      expect(pw).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
      for (const ch of pw.replaceAll("-", "")) expect(ALPHABET).toContain(ch);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[2-9]/);
    }
  });

  it("is long enough to pass the password rule", () => {
    expect(generateTempPassword().length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
  });

  it("skips byte values that would bias the alphabet and redraws until both kinds of character appear", () => {
    // 255 is rejected (>= 248); 0 -> 'a'; 30 -> '9'
    const batches = [
      new Uint8Array(16).fill(0),
      Uint8Array.from([255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 0, 0, 0, 0]),
    ];
    let call = 0;
    const pw = generateTempPassword(() => batches[Math.min(call++, batches.length - 1)]);
    expect(pw).toBe("aaaa-aaaa-aa9a");
  });
});

describe("checkNewPassword", () => {
  it("needs at least 10 characters", () => {
    expect(checkNewPassword("a".repeat(9), "a".repeat(9))).toBe("too_short");
    expect(checkNewPassword("a".repeat(10), "a".repeat(10))).toBeNull();
  });

  it("needs both entries to match", () => {
    expect(checkNewPassword("correct horse", "correct house")).toBe("mismatch");
  });
});
```

Note on the third test: the first batch (all zeros) gives `aaaa-aaaa-aaaa`, which has no digit, so the
generator draws again; the second batch skips the 255 and yields ten `a`, a `9`, then one more `a` →
`aaaa-aaaa-aa9a`.

Create `tests/unit/auth-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createUserErrorCode, passwordUpdateErrorCode, signInErrorCode } from "@/auth/errors";

describe("Supabase Auth errors", () => {
  it("sign-in: wrong email or password look the same to the person", () => {
    expect(signInErrorCode(null)).toBeNull();
    expect(signInErrorCode({ code: "invalid_credentials", status: 400 })).toBe("invalid");
    expect(signInErrorCode({ code: "email_not_confirmed" })).toBe("invalid");
    expect(signInErrorCode({ code: "user_banned" })).toBe("invalid");
    expect(signInErrorCode({ code: "over_request_rate_limit", status: 429 })).toBe("rate_limited");
    expect(signInErrorCode({ status: 429 })).toBe("rate_limited");
    expect(signInErrorCode({ code: "unexpected_failure", status: 500 })).toBe("unknown");
  });

  it("password change", () => {
    expect(passwordUpdateErrorCode(null)).toBeNull();
    expect(passwordUpdateErrorCode({ code: "same_password" })).toBe("same");
    expect(passwordUpdateErrorCode({ code: "weak_password" })).toBe("weak");
    expect(passwordUpdateErrorCode({ code: "reauthentication_needed" })).toBe("reauth");
    expect(passwordUpdateErrorCode({ code: "session_not_found" })).toBe("unknown");
  });

  it("account creation", () => {
    expect(createUserErrorCode(null)).toBeNull();
    expect(createUserErrorCode({ code: "email_exists" })).toBe("email_taken");
    expect(createUserErrorCode({ code: "user_already_exists" })).toBe("email_taken");
    expect(createUserErrorCode({ code: "email_address_invalid" })).toBe("invalid_email");
    expect(createUserErrorCode({ code: "validation_failed" })).toBe("invalid_email");
    expect(createUserErrorCode({ code: "weak_password" })).toBe("weak");
    expect(createUserErrorCode({ code: "unexpected_failure" })).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/password.test.ts tests/unit/auth-errors.test.ts`
Expected: FAIL — cannot resolve `@/auth/password` / `@/auth/errors`.

- [ ] **Step 3: Implement**

Create `src/auth/password.ts`:

```ts
/** Shortest password the app accepts (also the one-time passwords it issues are longer than this). */
export const MIN_PASSWORD_LENGTH = 10;

// No i, l, o, 0 or 1: a one-time password is read aloud or copied by hand.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
// Largest multiple of the alphabet size below 256: bytes at or above it are skipped (no modulo bias).
const LIMIT = 256 - (256 % ALPHABET.length);

function cryptoBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/**
 * A one-time password an Admin hands over, e.g. "kp7m-x3qd-9hwa": 12 characters (about 59 bits),
 * at least one letter and one digit so it passes common password rules.
 */
export function generateTempPassword(randomBytes: (n: number) => Uint8Array = cryptoBytes): string {
  for (;;) {
    const chars: string[] = [];
    while (chars.length < 12) {
      for (const b of randomBytes(16)) {
        if (b < LIMIT && chars.length < 12) chars.push(ALPHABET[b % ALPHABET.length]);
      }
    }
    const body = chars.join("");
    if (/[a-z]/.test(body) && /[2-9]/.test(body)) {
      return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
    }
  }
}

export type NewPasswordError = "too_short" | "mismatch";

/** The rules the app checks before asking Supabase to change a password. */
export function checkNewPassword(password: string, confirm: string): NewPasswordError | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (password !== confirm) return "mismatch";
  return null;
}
```

Create `src/auth/errors.ts`:

```ts
/** The parts of a Supabase Auth error the app looks at. */
export type AuthErrorLike = { code?: string; status?: number };

export type SignInError = "invalid" | "rate_limited" | "unknown";

/** Never tell "no such email" from "wrong password": both are "invalid". */
export function signInErrorCode(error: AuthErrorLike | null): SignInError | null {
  if (!error) return null;
  if (error.code === "over_request_rate_limit" || error.status === 429) return "rate_limited";
  if (error.code === "invalid_credentials" || error.code === "email_not_confirmed" || error.code === "user_banned") return "invalid";
  return "unknown";
}

export type PasswordUpdateError = "same" | "weak" | "reauth" | "unknown";

export function passwordUpdateErrorCode(error: AuthErrorLike | null): PasswordUpdateError | null {
  if (!error) return null;
  if (error.code === "same_password") return "same";
  if (error.code === "weak_password") return "weak";
  if (error.code === "reauthentication_needed") return "reauth";
  return "unknown";
}

export type CreateUserError = "email_taken" | "invalid_email" | "weak" | "unknown";

export function createUserErrorCode(error: AuthErrorLike | null): CreateUserError | null {
  if (!error) return null;
  if (error.code === "email_exists" || error.code === "user_already_exists") return "email_taken";
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return "invalid_email";
  if (error.code === "weak_password") return "weak";
  return "unknown";
}
```

- [ ] **Step 4: Access decision — failing test, then code**

In `tests/unit/access.test.ts`, give the fixture the new field and add a test:

```ts
const staff: Profile = { id: "u1", email: "a@ctyhp.vn", fullName: "A", avatarUrl: null, role: "user", status: "active", passwordAccount: true };
```

```ts
  it("sends someone still on a one-time password to set their own, before anything else", () => {
    expect(decideAccess(null, "must_change_password", "user")).toEqual({ kind: "change_password" });
    expect(decideAccess(null, "must_change_password", "admin")).toEqual({ kind: "change_password" });
  });
```

In `src/auth/access.ts`:

```ts
export type AccessStatus = "ok" | "signed_out" | "not_permitted" | "suspended" | "must_change_password";

export type Profile = {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: Role;
  status: Status;
  /** Created by an Admin with a password (as opposed to a Google account). */
  passwordAccount: boolean;
};

export type Decision =
  | { kind: "allow"; profile: Profile }
  | { kind: "login"; error?: "not_permitted" | "suspended" }
  | { kind: "change_password" }
  | { kind: "not_found" };
```

and in `decideAccess`, right after the `signed_out` line:

```ts
  if (status === "must_change_password") return { kind: "change_password" };
```

- [ ] **Step 5: `GOOGLE_SIGN_IN` flag — failing test, then code**

In `tests/unit/env.test.ts`, change the first test and add one:

```ts
  it("accepts a complete environment; Google sign-in is off unless switched on", () => {
    expect(parseEnv(good)).toEqual({ ...good, GOOGLE_SIGN_IN: "off" });
    expect(parseEnv({ ...good, GOOGLE_SIGN_IN: "on" }).GOOGLE_SIGN_IN).toBe("on");
  });

  it("rejects an unknown GOOGLE_SIGN_IN value", () => {
    expect(() => parseEnv({ ...good, GOOGLE_SIGN_IN: "yes" })).toThrow(/GOOGLE_SIGN_IN/);
  });
```

In `src/lib/env.ts`, add to the schema:

```ts
  /** "on" shows the Google button on the sign-in screen (2026-10-08: off until Google is set up). */
  GOOGLE_SIGN_IN: z.enum(["on", "off"]).default("off"),
```

- [ ] **Step 6: Interface copy**

In `src/messages/vi.ts` (the `as const` object), make these changes. `login.lead` and
`login.errors.notPermitted` change wording; everything else is new.

```ts
  common: {
    signOut: "Đăng xuất",
    language: "Ngôn ngữ",
    admin: "Quản trị",
    sheets: "Phiếu",
    changePassword: "Đổi mật khẩu",
    cancel: "Huỷ",
    copy: "Sao chép",
    copied: "Đã sao chép",
  },
  login: {
    title: "Đăng nhập",
    lead: "Dùng email công ty và mật khẩu quản trị viên cấp cho bạn.",
    email: "Email",
    password: "Mật khẩu",
    submit: "Đăng nhập",
    submitting: "Đang đăng nhập…",
    or: "hoặc",
    google: "Đăng nhập bằng Google",
    errors: {
      invalid: "Email hoặc mật khẩu không đúng.",
      rateLimited: "Thử sai quá nhiều lần. Chờ vài phút rồi thử lại.",
      unknown: "Không đăng nhập được. Thử lại.",
      notPermitted: "Tài khoản này chưa được cấp quyền vào hệ thống. Liên hệ quản trị viên.",
      suspended: "Tài khoản của bạn đã bị khoá. Liên hệ quản trị viên.",
      google: "Không đăng nhập được với Google. Thử lại.",
    },
  },
  account: {
    password: {
      titleForced: "Đặt mật khẩu của bạn",
      leadForced: "Mật khẩu quản trị viên cấp chỉ dùng cho lần đăng nhập đầu. Hãy đặt mật khẩu của riêng bạn để tiếp tục.",
      title: "Đổi mật khẩu",
      lead: "Mật khẩu mới dùng cho các lần đăng nhập sau.",
      newPassword: "Mật khẩu mới",
      confirm: "Nhập lại mật khẩu mới",
      rule: "Ít nhất 10 ký tự. Một cụm từ dễ nhớ là lựa chọn tốt.",
      submit: "Lưu mật khẩu",
      submitting: "Đang lưu…",
      back: "Quay lại",
      errors: {
        tooShort: "Mật khẩu cần ít nhất 10 ký tự.",
        mismatch: "Hai lần nhập không khớp.",
        same: "Mật khẩu mới phải khác mật khẩu cũ.",
        weak: "Mật khẩu này quá dễ đoán. Chọn mật khẩu khác.",
        reauth: "Phiên đăng nhập đã lâu. Đăng xuất, đăng nhập lại rồi đổi mật khẩu.",
        unknown: "Không lưu được mật khẩu. Thử lại.",
      },
    },
  },
```

and inside `admin`, after `areas`:

```ts
    users: {
      title: "Người dùng",
      lead: "Tạo tài khoản đăng nhập bằng mật khẩu và cấp lại mật khẩu khi cần.",
      add: "Thêm người dùng",
      fullName: "Họ tên",
      email: "Email",
      role: "Vai trò",
      roles: { user: "Nhân viên", admin: "Quản trị viên" },
      create: "Tạo tài khoản",
      creating: "Đang tạo…",
      createdTitle: "Đã tạo tài khoản",
      resetTitle: "Đã cấp mật khẩu mới",
      tempLead: "Mật khẩu một lần dưới đây chỉ hiện lúc này. Gửi riêng cho người dùng; họ phải đặt mật khẩu của mình ngay khi đăng nhập.",
      columns: { user: "Người dùng", role: "Vai trò", status: "Trạng thái", signIn: "Đăng nhập bằng", lastSeen: "Hoạt động gần nhất" },
      status: { active: "Đang hoạt động", suspended: "Đã khoá" },
      signIn: { password: "Mật khẩu", google: "Google" },
      mustChange: "Chờ đặt mật khẩu",
      you: "(bạn)",
      never: "Chưa đăng nhập",
      reset: "Cấp lại mật khẩu",
      resetConfirm: "Cấp mật khẩu một lần mới? Người này bị đăng xuất khỏi mọi thiết bị.",
      resetYes: "Cấp mật khẩu mới",
      errors: {
        emailTaken: "Email này đã có tài khoản.",
        invalidEmail: "Email không hợp lệ.",
        nameRequired: "Nhập họ tên (tối đa 120 ký tự).",
        weak: "Supabase từ chối mật khẩu một lần. Kiểm tra yêu cầu mật khẩu trong Authentication.",
        selfReset: "Đổi mật khẩu của chính bạn ở trang Đổi mật khẩu.",
        notPasswordAccount: "Tài khoản này đăng nhập bằng Google, không có mật khẩu để cấp lại.",
        forbidden: "Chỉ quản trị viên làm được việc này.",
        unknown: "Không thực hiện được. Thử lại.",
      },
    },
```

In `src/messages/en.ts`, the same keys:

```ts
  common: {
    signOut: "Sign out",
    language: "Language",
    admin: "Admin",
    sheets: "Sheets",
    changePassword: "Change password",
    cancel: "Cancel",
    copy: "Copy",
    copied: "Copied",
  },
  login: {
    title: "Sign in",
    lead: "Use your company email and the password an administrator gave you.",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in…",
    or: "or",
    google: "Sign in with Google",
    errors: {
      invalid: "The email or password is not correct.",
      rateLimited: "Too many attempts. Wait a few minutes and try again.",
      unknown: "Sign-in did not complete. Try again.",
      notPermitted: "This account has not been given access. Contact an administrator.",
      suspended: "Your account has been suspended. Contact an administrator.",
      google: "Google sign-in did not complete. Try again.",
    },
  },
  account: {
    password: {
      titleForced: "Set your password",
      leadForced: "The password an administrator gave you works for the first sign-in only. Set your own password to continue.",
      title: "Change password",
      lead: "Use the new password from your next sign-in.",
      newPassword: "New password",
      confirm: "Repeat the new password",
      rule: "At least 10 characters. A phrase you can remember works well.",
      submit: "Save password",
      submitting: "Saving…",
      back: "Back",
      errors: {
        tooShort: "The password needs at least 10 characters.",
        mismatch: "The two entries do not match.",
        same: "The new password must differ from the old one.",
        weak: "This password is too easy to guess. Choose another.",
        reauth: "You signed in a while ago. Sign out, sign in again, then change the password.",
        unknown: "The password was not saved. Try again.",
      },
    },
  },
```

```ts
    users: {
      title: "Users",
      lead: "Create password sign-in accounts and issue a new password when needed.",
      add: "Add user",
      fullName: "Full name",
      email: "Email",
      role: "Role",
      roles: { user: "Staff", admin: "Admin" },
      create: "Create account",
      creating: "Creating…",
      createdTitle: "Account created",
      resetTitle: "New password issued",
      tempLead: "This one-time password is shown only now. Send it to the person privately; they must set their own password when they sign in.",
      columns: { user: "User", role: "Role", status: "Status", signIn: "Signs in with", lastSeen: "Last active" },
      status: { active: "Active", suspended: "Suspended" },
      signIn: { password: "Password", google: "Google" },
      mustChange: "Password not yet set",
      you: "(you)",
      never: "Never signed in",
      reset: "Issue new password",
      resetConfirm: "Issue a new one-time password? The person is signed out on every device.",
      resetYes: "Issue new password",
      errors: {
        emailTaken: "This email already has an account.",
        invalidEmail: "This email is not valid.",
        nameRequired: "Enter a full name (up to 120 characters).",
        weak: "Supabase refused the one-time password. Check the password requirements under Authentication.",
        selfReset: "Change your own password on the Change password page.",
        notPasswordAccount: "This account signs in with Google; it has no password to reissue.",
        forbidden: "Only administrators can do this.",
        unknown: "That did not work. Try again.",
      },
    },
```

- [ ] **Step 7: Run unit tests and typecheck**

Run: `npx vitest run tests/unit` — Expected: PASS.
Run: `npm run typecheck` — Expected: errors only where `Profile` objects are built without
`passwordAccount` (`src/auth/session.ts`). Fix that one place now: add `password_account: boolean` to
`ProfileRow`, select `password_account` in `loadAccess`, and map it to `passwordAccount`. Re-run until clean.

- [ ] **Step 8: Commit**

```bash
git add src/auth/password.ts
git add src/auth/errors.ts
git add src/auth/access.ts
git add src/auth/session.ts
git add src/lib/env.ts
git add src/messages/vi.ts
git add src/messages/en.ts
git add tests/unit/password.test.ts
git add tests/unit/auth-errors.test.ts
git add tests/unit/access.test.ts
git add tests/unit/env.test.ts
git commit -m "feat(auth): one-time passwords, sign-in error codes, the change-password decision and copy"
```

---

### Task 3: Sign in with email and password

**Files:**
- Create: `src/auth/denied.ts`, `src/app/login/password-form.tsx`
- Modify: `src/auth/actions.ts`, `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`,
  `src/auth/session.ts`, `src/ui/app-header.tsx`

**Interfaces:**
- Consumes: `signInErrorCode`, `SignInError` (Task 2); `my_access_status()` returning `must_change_password` (Task 1); `Decision` `change_password` (Task 2); `getEnv().GOOGLE_SIGN_IN` (Task 2)
- Produces:
  - `recordDenied(user: { id: string; email: string | null }, reason: string): Promise<void>`
  - `type SignInState = { error: SignInError | "suspended" | "not_permitted" | null; email: string }`
  - `signInWithPassword(prev: SignInState, form: FormData): Promise<SignInState>` (fields `email`, `password`, `next`)
  - Guards redirect a person on a one-time password to `/account/password?next=<path>`

- [ ] **Step 1: `recordDenied` and the callback**

Create `src/auth/denied.ts`:

```ts
import "server-only";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Logs auth.denied for an account that signed in but may not enter (BR-08, BR-14). Uses the secret key
 * because a refused account cannot write to the audit log itself. The person is turned away either way;
 * a missing audit row must not go unnoticed.
 */
export async function recordDenied(user: { id: string; email: string | null }, reason: string): Promise<void> {
  const { error } = await createSupabaseAdmin().from("audit_log").insert({
    actor_email: user.email,
    action: "auth.denied",
    target_type: "user",
    target_id: user.id,
    detail: { reason },
  });
  if (error) console.error("auth.denied was not written to audit_log:", error.message);
}
```

In `src/app/auth/callback/route.ts`, replace the inline `createSupabaseAdmin().from("audit_log").insert(...)`
block and its `console.error` with:

```ts
    await recordDenied({ id: data.user.id, email: data.user.email ?? null }, status);
```

(import `recordDenied` from `@/auth/denied`; drop the now-unused `createSupabaseAdmin` import).

- [ ] **Step 2: The sign-in action**

In `src/auth/actions.ts`, add (keep `signInWithGoogle` and `signOut` as they are):

```ts
import { recordDenied } from "./denied";
import { signInErrorCode, type SignInError } from "./errors";

export type SignInState = { error: SignInError | "suspended" | "not_permitted" | null; email: string };

/**
 * Email + password sign-in (BR-08: only accounts an Admin created get in). After Supabase accepts the
 * password the database decides: someone on a one-time password goes to set their own; a refused
 * account is logged, signed out and told why; everyone else lands on the page they asked for.
 */
export async function signInWithPassword(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  if (!email || !password) return { error: "invalid", email };

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  const failed = signInErrorCode(error);
  if (failed || !data.user) return { error: failed ?? "unknown", email };

  const { data: status, error: statusError } = await supabase.rpc("my_access_status");
  if (statusError || status === "signed_out") {
    await supabase.auth.signOut();
    return { error: "unknown", email };
  }
  if (status === "must_change_password") redirect(`/account/password?next=${encodeURIComponent(next)}`);
  if (status !== "ok") {
    await recordDenied({ id: data.user.id, email: data.user.email ?? email }, String(status));
    await supabase.auth.signOut();
    return { error: status === "suspended" ? "suspended" : "not_permitted", email };
  }

  const { error: touchError } = await supabase.rpc("touch_profile");
  if (touchError) {
    await supabase.auth.signOut();
    return { error: "unknown", email };
  }
  redirect(next);
}
```

`redirect()` throws on purpose; never wrap these calls in `try`.

- [ ] **Step 3: The sign-in form**

Create `src/app/login/password-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { signInWithPassword, type SignInState } from "@/auth/actions";
import { useMessages } from "@/messages/client";

const initial: SignInState = { error: null, email: "" };

const field = "w-full rounded-md border border-line bg-surface px-3 py-2";

export function PasswordSignInForm({ next }: { next: string }) {
  const t = useMessages();
  const [state, action, pending] = useActionState(signInWithPassword, initial);
  const errors = {
    invalid: t.login.errors.invalid,
    rate_limited: t.login.errors.rateLimited,
    unknown: t.login.errors.unknown,
    suspended: t.login.errors.suspended,
    not_permitted: t.login.errors.notPermitted,
  } as const;
  const message = state.error ? errors[state.error] : null;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {message && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
          {message}
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium">{t.login.email}</label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state.email} className={field} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium">{t.login.password}</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={field} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink hover:opacity-90 disabled:opacity-60"
      >
        {pending ? t.login.submitting : t.login.submit}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: The sign-in page**

Replace `src/app/login/page.tsx` with:

```tsx
import { signInWithGoogle } from "@/auth/actions";
import { safeNext } from "@/auth/redirect";
import { getEnv } from "@/lib/env";
import type { Messages } from "@/messages";
import { getMessages } from "@/messages/server";
import { LanguageSwitch } from "@/ui/language-switch";
import { PasswordSignInForm } from "./password-form";

/** Reasons a guard or the Google callback sends people back here with. */
function errorText(code: string | undefined, t: Messages): string | null {
  if (code === "not_permitted") return t.login.errors.notPermitted;
  if (code === "suspended") return t.login.errors.suspended;
  if (code === "google") return t.login.errors.google;
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const t = await getMessages();
  const error = errorText(params.error, t);
  const next = safeNext(params.next);
  const google = getEnv().GOOGLE_SIGN_IN === "on";
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{t.app.name}</h1>
            <p className="mt-1 text-sm text-ink-2">{t.login.lead}</p>
          </div>
          <LanguageSwitch />
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
            {error}
          </p>
        )}
        <PasswordSignInForm next={next} />
        {google && (
          <>
            <div className="flex items-center gap-3 text-xs text-ink-3">
              <span className="h-px flex-1 bg-line" />
              {t.login.or}
              <span className="h-px flex-1 bg-line" />
            </div>
            <form action={signInWithGoogle}>
              <input type="hidden" name="next" value={next} />
              <button type="submit" className="w-full rounded-md border border-line px-4 py-2.5 font-semibold hover:bg-sunk">
                {t.login.google}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Guards and header**

In `src/auth/session.ts`, inside `ensure()`, after the `not_found` line:

```ts
  if (decision.kind === "change_password") redirect(`/account/password?${new URLSearchParams({ next }).toString()}`);
```

In `src/ui/app-header.tsx`, before the sign-out form:

```tsx
          {me.passwordAccount && (
            <Link href="/account/password" className="text-sm text-ink-2 hover:text-ink">
              {t.common.changePassword}
            </Link>
          )}
```

- [ ] **Step 6: Check**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit`
Expected: clean; all unit tests pass.

Run the dev server (PowerShell: `Start-Process -FilePath npm.cmd -ArgumentList "run","dev" -WindowStyle Hidden`), then:
`curl -s http://localhost:3000/login` shows "Email", "Mật khẩu", "Đăng nhập" and no "Google" button;
`curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://localhost:3000/sheets` → `307 …/login?next=%2Fsheets`.

- [ ] **Step 7: Commit**

```bash
git add src/auth/denied.ts
git add src/auth/actions.ts
git add src/app/login/page.tsx
git add src/app/login/password-form.tsx
git add src/app/auth/callback/route.ts
git add src/auth/session.ts
git add src/ui/app-header.tsx
git commit -m "feat(auth): sign in with email and password; Google stays behind GOOGLE_SIGN_IN"
```

---

### Task 4: Set or change the password

**Files:**
- Create: `src/app/account/password/page.tsx`, `src/app/account/password/form.tsx`
- Modify: `src/auth/actions.ts`

**Interfaces:**
- Consumes: `checkNewPassword`, `NewPasswordError` (Task 2); `passwordUpdateErrorCode`, `PasswordUpdateError` (Task 2); `finish_password_change()` (Task 1); `loadAccess()` returning `must_change_password` (Tasks 2–3)
- Produces:
  - `type ChangePasswordState = { error: NewPasswordError | PasswordUpdateError | null }`
  - `changePassword(prev: ChangePasswordState, form: FormData): Promise<ChangePasswordState>` (fields `password`, `confirm`, `next`)
  - Route `/account/password?next=<path>`

- [ ] **Step 1: The action**

In `src/auth/actions.ts`, add:

```ts
import { checkNewPassword, type NewPasswordError } from "./password";
import { passwordUpdateErrorCode, type PasswordUpdateError } from "./errors";

export type ChangePasswordState = { error: NewPasswordError | PasswordUpdateError | null };

/**
 * Sets a new password for the signed-in password account. After a one-time password this also lets
 * the person in: the database clears the flag only once the stored hash has changed, then the
 * sign-in is recorded (touch_profile).
 */
export async function changePassword(_prev: ChangePasswordState, form: FormData): Promise<ChangePasswordState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  const invalid = checkNewPassword(password, confirm);
  if (invalid) return { error: invalid };

  const supabase = await createSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent("/account/password")}`);
  const { data: before } = await supabase.rpc("my_access_status");
  if (before === "suspended" || before === "not_permitted") redirect(`/login?error=${before}`);

  const { error } = await supabase.auth.updateUser({ password });
  const failed = passwordUpdateErrorCode(error);
  if (failed) return { error: failed };

  const { error: finishError } = await supabase.rpc("finish_password_change");
  if (finishError) return { error: "unknown" };
  if (before === "must_change_password") {
    const { error: touchError } = await supabase.rpc("touch_profile");
    if (touchError) return { error: "unknown" };
  }
  redirect(next);
}
```

(Merge the new imports with the existing ones at the top of the file.)

- [ ] **Step 2: The form**

Create `src/app/account/password/form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "@/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/auth/password";
import { useMessages } from "@/messages/client";

const initial: ChangePasswordState = { error: null };
const field = "w-full rounded-md border border-line bg-surface px-3 py-2";

export function ChangePasswordForm({ next }: { next: string }) {
  const t = useMessages();
  const m = t.account.password;
  const [state, action, pending] = useActionState(changePassword, initial);
  const errors = {
    too_short: m.errors.tooShort,
    mismatch: m.errors.mismatch,
    same: m.errors.same,
    weak: m.errors.weak,
    reauth: m.errors.reauth,
    unknown: m.errors.unknown,
  } as const;
  const message = state.error ? errors[state.error] : null;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {message && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
          {message}
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium">{m.newPassword}</label>
        <input
          id="password" name="password" type="password" autoComplete="new-password" required
          minLength={MIN_PASSWORD_LENGTH} aria-describedby="password-rule" className={field}
        />
        <p id="password-rule" className="text-xs text-ink-2">{m.rule}</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="confirm" className="block text-sm font-medium">{m.confirm}</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} className={field} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink hover:opacity-90 disabled:opacity-60"
      >
        {pending ? m.submitting : m.submit}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: The page**

Create `src/app/account/password/page.tsx`:

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { safeNext } from "@/auth/redirect";
import { loadAccess } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { LanguageSwitch } from "@/ui/language-switch";
import { ChangePasswordForm } from "./form";

/**
 * Outside the (app) layout on purpose: someone on a one-time password may not see any app page yet,
 * but must reach this one. Google accounts have no password here.
 */
export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const { profile, status } = await loadAccess();
  if (status === "signed_out") redirect(`/login?next=${encodeURIComponent("/account/password")}`);
  if (status === "suspended" || status === "not_permitted") redirect(`/login?error=${status}`);
  const forced = status === "must_change_password";
  if (!forced && !profile?.passwordAccount) notFound();

  const t = await getMessages();
  const m = t.account.password;
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{forced ? m.titleForced : m.title}</h1>
            <p className="mt-1 text-sm text-ink-2">{forced ? m.leadForced : m.lead}</p>
          </div>
          <LanguageSwitch />
        </div>
        <ChangePasswordForm next={next} />
        {!forced && (
          <Link href={next} className="block text-center text-sm text-ink-2 hover:text-ink">
            {m.back}
          </Link>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Check**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit` — Expected: clean.
With the dev server running: `curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://localhost:3000/account/password`
→ `307 …/login?next=%2Faccount%2Fpassword`.

- [ ] **Step 5: Commit**

```bash
git add src/auth/actions.ts
git add src/app/account/password/page.tsx
git add src/app/account/password/form.tsx
git commit -m "feat(auth): set your own password after a one-time password, or change it later"
```

---

### Task 5: Admin → Users, and the first Admin

**Files:**
- Create: `src/admin/user-actions.ts`
- Create: `src/app/(app)/admin/users/page.tsx`, `add-user-form.tsx`, `issued-password.tsx`, `reset-password.tsx` (all in that folder)
- Create: `scripts/create-admin.mts`
- Modify: `src/app/(app)/admin/page.tsx`, `src/lib/supabase/admin.ts`, `package.json`

**Interfaces:**
- Consumes: `generateTempPassword` (Task 2); `createUserErrorCode`, `CreateUserError` (Task 2); `admin_register_password_account`, `admin_mark_password_reset` (Task 1); `requireAdmin()`; `createSupabaseAdmin()`; message keys `admin.users.*`, `common.copy`, `common.copied`, `common.cancel`
- Produces:
  - `type IssuedPassword = { email: string; tempPassword: string }`
  - `type NewUserValues = { email: string; fullName: string; role: "user" | "admin" }`
  - `type CreateUserState = { error: CreateUserError | "name_required" | "forbidden" | null; issued: IssuedPassword | null; values: NewUserValues }`
  - `createPasswordUser(prev: CreateUserState, form: FormData): Promise<CreateUserState>` (fields `fullName`, `email`, `role`)
  - `type ResetPasswordState = { error: "self_reset" | "not_password_account" | "unknown" | null; issued: IssuedPassword | null }`
  - `resetPassword(prev: ResetPasswordState, form: FormData): Promise<ResetPasswordState>` (field `userId`)
  - Route `/admin/users`; script `npm run admin:create -- <email> "<Full name>"`

- [ ] **Step 1: Server actions**

Create `src/admin/user-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createUserErrorCode, type CreateUserError } from "@/auth/errors";
import { generateTempPassword } from "@/auth/password";
import { requireAdmin } from "@/auth/session";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

export type IssuedPassword = { email: string; tempPassword: string };
export type NewUserValues = { email: string; fullName: string; role: "user" | "admin" };

export type CreateUserState = {
  error: CreateUserError | "name_required" | "forbidden" | null;
  issued: IssuedPassword | null;
  values: NewUserValues;
};

const newUser = z.object({
  email: z.email().transform((s) => s.toLowerCase()),
  fullName: z.string().trim().min(1).max(120),
  role: z.enum(["user", "admin"]),
});

const EMPTY: NewUserValues = { email: "", fullName: "", role: "user" };

/**
 * Creates a password account (UC-13, decisions of 2026-10-08): the sign-in account is created with the
 * secret key, then registered in the Admin's own session so the audit row names the Admin. If the
 * registration fails the sign-in account is deleted again, so no half-made account can sign in.
 */
export async function createPasswordUser(_prev: CreateUserState, form: FormData): Promise<CreateUserState> {
  await requireAdmin("/admin/users");
  const values: NewUserValues = {
    email: String(form.get("email") ?? "").trim(),
    fullName: String(form.get("fullName") ?? ""),
    role: form.get("role") === "admin" ? "admin" : "user",
  };
  const parsed = newUser.safeParse(values);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field === "fullName" ? "name_required" : "invalid_email", issued: null, values };
  }
  const { email, fullName, role } = parsed.data;

  const tempPassword = generateTempPassword();
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) return { error: createUserErrorCode(error) ?? "unknown", issued: null, values };

  const supabase = await createSupabaseServer();
  const { error: registerError } = await supabase.rpc("admin_register_password_account", {
    p_user: data.user.id,
    p_full_name: fullName,
    p_role: role,
  });
  if (registerError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: registerError.message.includes("forbidden") ? "forbidden" : "unknown", issued: null, values };
  }
  revalidatePath("/admin/users");
  return { error: null, issued: { email, tempPassword }, values: EMPTY };
}

export type ResetPasswordState = {
  error: "self_reset" | "not_password_account" | "unknown" | null;
  issued: IssuedPassword | null;
};

/**
 * Issues a new one-time password: set with the secret key, then marked in the Admin's own session,
 * which also ends every session the person has.
 */
export async function resetPassword(_prev: ResetPasswordState, form: FormData): Promise<ResetPasswordState> {
  const me = await requireAdmin("/admin/users");
  const userId = String(form.get("userId") ?? "");
  if (!z.uuid().safeParse(userId).success) return { error: "unknown", issued: null };
  if (userId === me.id) return { error: "self_reset", issued: null };

  const supabase = await createSupabaseServer();
  const { data: target, error: readError } = await supabase
    .from("profiles")
    .select("email, password_account")
    .eq("id", userId)
    .maybeSingle<{ email: string; password_account: boolean }>();
  if (readError || !target) return { error: "unknown", issued: null };
  if (!target.password_account) return { error: "not_password_account", issued: null };

  const tempPassword = generateTempPassword();
  const { error } = await createSupabaseAdmin().auth.admin.updateUserById(userId, { password: tempPassword });
  if (error) return { error: "unknown", issued: null };
  const { error: markError } = await supabase.rpc("admin_mark_password_reset", { p_user: userId });
  if (markError) return { error: "unknown", issued: null };
  revalidatePath("/admin/users");
  return { error: null, issued: { email: target.email, tempPassword } };
}
```

- [ ] **Step 2: Client pieces**

Create `src/app/(app)/admin/users/issued-password.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { IssuedPassword } from "@/admin/user-actions";
import { useMessages } from "@/messages/client";

/** Shows a one-time password once, with a copy button; it is never stored by the app. */
export function IssuedPasswordNotice({ title, issued }: { title: string; issued: IssuedPassword }) {
  const t = useMessages();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.tempPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div role="status" className="space-y-2 rounded-md border border-accent bg-accent-soft p-3 text-left text-sm">
      <p className="font-semibold">
        {title}: <span className="font-mono">{issued.email}</span>
      </p>
      <p className="text-ink-2">{t.admin.users.tempLead}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="select-all rounded bg-surface px-2 py-1 font-mono text-base tracking-wider">{issued.tempPassword}</code>
        <button type="button" onClick={copy} className="rounded border border-line bg-surface px-3 py-1 hover:bg-sunk">
          {copied ? t.common.copied : t.common.copy}
        </button>
      </div>
    </div>
  );
}
```

Create `src/app/(app)/admin/users/add-user-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { createPasswordUser, type CreateUserState } from "@/admin/user-actions";
import { useMessages } from "@/messages/client";
import { IssuedPasswordNotice } from "./issued-password";

const initial: CreateUserState = { error: null, issued: null, values: { email: "", fullName: "", role: "user" } };
const field = "w-full rounded-md border border-line bg-surface px-3 py-2";

export function AddUserForm() {
  const t = useMessages();
  const u = t.admin.users;
  const [state, action, pending] = useActionState(createPasswordUser, initial);
  const errors = {
    email_taken: u.errors.emailTaken,
    invalid_email: u.errors.invalidEmail,
    weak: u.errors.weak,
    name_required: u.errors.nameRequired,
    forbidden: u.errors.forbidden,
    unknown: u.errors.unknown,
  } as const;
  const message = state.error ? errors[state.error] : null;
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-semibold">{u.add}</h2>
      {state.issued && <IssuedPasswordNotice title={u.createdTitle} issued={state.issued} />}
      {message && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
          {message}
        </p>
      )}
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{u.fullName}</span>
          <input name="fullName" required maxLength={120} autoComplete="off" defaultValue={state.values.fullName} className={field} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{u.email}</span>
          <input name="email" type="email" required autoComplete="off" defaultValue={state.values.email} className={field} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{u.role}</span>
          <select name="role" defaultValue={state.values.role} className={field}>
            <option value="user">{u.roles.user}</option>
            <option value="admin">{u.roles.admin}</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink hover:opacity-90 disabled:opacity-60"
        >
          {pending ? u.creating : u.create}
        </button>
      </form>
    </section>
  );
}
```

Create `src/app/(app)/admin/users/reset-password.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { resetPassword, type ResetPasswordState } from "@/admin/user-actions";
import { useMessages } from "@/messages/client";
import { IssuedPasswordNotice } from "./issued-password";

const initial: ResetPasswordState = { error: null, issued: null };

/** A two-step control: ask first (no browser dialogs), then show the new one-time password once. */
export function ResetPasswordButton({ userId }: { userId: string }) {
  const t = useMessages();
  const u = t.admin.users;
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(resetPassword, initial);
  if (state.issued) return <IssuedPasswordNotice title={u.resetTitle} issued={state.issued} />;
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="rounded border border-line px-3 py-1 hover:bg-sunk">
        {u.reset}
      </button>
    );
  }
  const errors = { self_reset: u.errors.selfReset, not_password_account: u.errors.notPasswordAccount, unknown: u.errors.unknown } as const;
  return (
    <form action={action} className="space-y-2 text-left">
      <input type="hidden" name="userId" value={userId} />
      <p className="text-sm">{u.resetConfirm}</p>
      {state.error && <p role="alert" className="text-sm text-danger">{errors[state.error]}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="rounded bg-accent px-3 py-1 font-semibold text-accent-ink disabled:opacity-60">
          {u.resetYes}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="rounded border border-line px-3 py-1 hover:bg-sunk">
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: The page and the Admin index link**

Create `src/app/(app)/admin/users/page.tsx`:

```tsx
import { requireAdmin } from "@/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getLocale, getMessages } from "@/messages/server";
import { AddUserForm } from "./add-user-form";
import { ResetPasswordButton } from "./reset-password";

type Row = {
  id: string;
  email: string;
  full_name: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  password_account: boolean;
  must_change_password: boolean;
  last_seen_at: string | null;
};

export default async function UsersPage() {
  const me = await requireAdmin("/admin/users");
  const t = await getMessages();
  const locale = await getLocale();
  const u = t.admin.users;
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, status, password_account, must_change_password, last_seen_at")
    .order("email");
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const when = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  });
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{u.title}</h1>
        <p className="text-ink-2">{u.lead}</p>
      </div>
      <AddUserForm />
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-sunk text-left text-ink-2">
            <tr>
              <th className="px-3 py-2 font-medium">{u.columns.user}</th>
              <th className="px-3 py-2 font-medium">{u.columns.role}</th>
              <th className="px-3 py-2 font-medium">{u.columns.status}</th>
              <th className="px-3 py-2 font-medium">{u.columns.signIn}</th>
              <th className="px-3 py-2 font-medium">{u.columns.lastSeen}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {row.full_name ?? row.email}
                    {row.id === me.id && <span className="font-normal text-ink-3"> {u.you}</span>}
                  </div>
                  <div className="font-mono text-xs text-ink-2">{row.email}</div>
                </td>
                <td className="px-3 py-2">{u.roles[row.role]}</td>
                <td className="px-3 py-2">
                  {u.status[row.status]}
                  {row.must_change_password && (
                    <span className="ml-2 whitespace-nowrap rounded bg-warn-soft px-1.5 py-0.5 text-xs">{u.mustChange}</span>
                  )}
                </td>
                <td className="px-3 py-2">{row.password_account ? u.signIn.password : u.signIn.google}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.last_seen_at ? when.format(new Date(row.last_seen_at)) : u.never}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.password_account && row.id !== me.id && <ResetPasswordButton userId={row.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

In `src/app/(app)/admin/page.tsx`, render the Users area as a link and keep the others as they are:

```tsx
import Link from "next/link";
import { getMessages } from "@/messages/server";

export default async function AdminPage() {
  const t = await getMessages();
  const later = [t.admin.areas.access, t.admin.areas.audit, t.admin.areas.cleanup];
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t.admin.title}</h1>
      <p className="text-ink-2">{t.admin.lead}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        <li>
          <Link href="/admin/users" className="block rounded-lg border border-line bg-surface px-4 py-3 font-medium hover:bg-sunk">
            {t.admin.areas.users}
          </Link>
        </li>
        {later.map((name) => (
          <li key={name} className="rounded-lg border border-line bg-surface px-4 py-3 font-medium">
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

In `src/lib/supabase/admin.ts`, extend the comment's list of allowed uses: "creating a password account
and setting a one-time password (Admin → Users, `npm run admin:create`), deleting a sign-in account
whose registration failed".

- [ ] **Step 4: The first Admin script**

Create `scripts/create-admin.mts`:

```ts
/**
 * Creates the first Admin: a password account with a one-time password, printed once.
 *   npm run admin:create -- <email> "<Full name>"
 * Refuses when an active Admin already exists; later accounts are created in the app (Admin → Users).
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DATABASE_URL in .env.local.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { generateTempPassword } from "../src/auth/password";

config({ path: ".env.local", quiet: true });

async function main(): Promise<number> {
  const [emailArg, ...nameParts] = process.argv.slice(2);
  const email = (emailArg ?? "").trim().toLowerCase();
  const fullName = nameParts.join(" ").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !fullName) {
    console.error('Usage: npm run admin:create -- <email> "<Full name>"');
    return 1;
  }
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, DATABASE_URL: db } = process.env;
  if (!url || !key || !db) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and DATABASE_URL in .env.local.");
    return 1;
  }

  const sql = postgres(db, { max: 1, prepare: false, onnotice: () => {} });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.profiles where role = 'admin' and status = 'active'`;
    if (n > 0) {
      console.error("An active Admin already exists. Create further accounts in the app: Admin → Users.");
      return 1;
    }
    const tempPassword = generateTempPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) {
      console.error(`The sign-in account was not created: ${error?.message ?? "no user returned"}`);
      return 1;
    }
    const id = data.user.id;
    try {
      await sql.begin(async (tx) => {
        const [u] = await tx<{ encrypted_password: string }[]>`select encrypted_password from auth.users where id = ${id}`;
        await tx`insert into public.profiles (id, email, full_name, role, password_account, must_change_password)
                 values (${id}, ${email}, ${fullName}, 'admin', true, true)`;
        await tx`insert into public.password_handovers (user_id, temp_hash) values (${id}, ${u.encrypted_password})`;
        await tx`insert into public.audit_log (actor_email, action, target_type, target_id, detail)
                 values (null, 'user.create', 'user', ${id},
                         ${tx.json({ email, role: "admin", sign_in: "password", by: "setup script" })})`;
      });
    } catch (e) {
      await admin.auth.admin.deleteUser(id);
      throw e;
    }
    console.log(`First Admin created: ${email}`);
    console.log(`One-time password (shown once): ${tempPassword}`);
    console.log("Sign in at /login; you will be asked to set your own password.");
    return 0;
  } finally {
    await sql.end();
  }
}

process.exitCode = await main();
```

In `package.json` `scripts`, add after `db:migrate`:

```json
    "admin:create": "tsx scripts/create-admin.mts",
```

- [ ] **Step 5: Check**

Run: `npm run typecheck && npm run lint && npm test` — Expected: clean, all pass.
Run: `npm run admin:create` (no arguments) — Expected: the usage line and exit code 1; nothing created.
With the dev server running: `curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://localhost:3000/admin/users`
→ `307 …/login?next=%2Fadmin%2Fusers`.

- [ ] **Step 6: Commit**

```bash
git add src/admin/user-actions.ts
git add "src/app/(app)/admin/users/page.tsx"
git add "src/app/(app)/admin/users/add-user-form.tsx"
git add "src/app/(app)/admin/users/issued-password.tsx"
git add "src/app/(app)/admin/users/reset-password.tsx"
git add "src/app/(app)/admin/page.tsx"
git add src/lib/supabase/admin.ts
git add scripts/create-admin.mts
git add package.json
git commit -m "feat(admin): create password accounts and issue one-time passwords; a script for the first Admin"
```

---

### Task 6: Setup and design documents

**Files:**
- Modify: `README.md`, `.env.example`, `docs/design/spec-sheet-editor-design.md`,
  `docs/design/spec-sheet-editor-design.html`, `docs/plans/2026-10-07-spec-sheet-editor-roadmap.md`

- [ ] **Step 1: README**

- Stack line: `Supabase (Postgres + RLS, Storage, Auth: email + password; Google later)`.
- Replace Setup steps 1, 2 and 6 with:
  1. Create a Supabase project in Singapore. Under Authentication → Sign In / Providers keep **Email**
     enabled and turn **off** "Allow new users to sign up": accounts are created only by an Admin
     (the admin API ignores this switch). Turn off Phone and Anonymous sign-ins. Under URL
     Configuration list only exact callback URLs (`http://localhost:3000/auth/callback`, later the
     production one) — needed once Google is switched on.
  2. Google sign-in is optional and off by default (`GOOGLE_SIGN_IN=off`). To switch it on later:
     enable the Google provider, turn sign-ups back on (the database still admits only Google accounts
     on the permitted lists and accounts an Admin created), and set `GOOGLE_SIGN_IN=on`.
  6. Create the first Admin once: `npm run admin:create -- you@ctyhp.vn "Your Name"`. It prints a
     one-time password; sign in with it at `/login` and set your own password. Further accounts:
     Admin → Users.
- Scripts table: add `npm run admin:create` — "Create the first Admin (once)".

- [ ] **Step 2: `.env.example`**

Add after `SUPABASE_SECRET_KEY`:

```
# "on" shows the Google button on the sign-in screen (needs the Google provider in Supabase).
GOOGLE_SIGN_IN=off
```

- [ ] **Step 3: Design document (Markdown)**

In `docs/design/spec-sheet-editor-design.md`:
- Version table: add `| 1.2 | 08/10/2026 | Password sign-in for accounts an Admin creates (one-time password replaced at first sign-in); Google sign-in kept for later, side by side. BR-08, F-01, F-30, UC-01, UC-13, 6.2 and 6.4 updated. |`
- Assumption on the first Admin (section 1.5): "The first Admin is created once with `npm run admin:create`; from then on Admins create accounts in Admin → Users."
- BR-08 becomes: "A user may enter the system if and only if their account is not suspended, has replaced any one-time password, and either (a) signed in with Google with an email in a permitted domain or on the permitted email list, or (b) is a password account an Admin created. Domains are matched on the whole part after the `@`, case-insensitively."
- F-01 becomes "Sign-in" — "Sign in with an email and password an Admin issued; a one-time password must be replaced at the first sign-in. Google sign-in (permitted domains and emails) can be switched on later and runs alongside."
- Add F-30 under the Admin functions: `| F-30 | Password accounts | Create an account (name, email, role) with a one-time password shown once; issue a new one-time password, which signs the person out everywhere. | UC-13 | Must |`
- UC-01: preconditions "The user has an account an Admin created (or, once switched on, a Google account permitted under BR-08)"; main flow: enter email and password → the system checks BR-08 → on a one-time password the system asks for a new password (at least 10 characters) before anything else → the profile is touched and the audit entry written.
- UC-13: add steps "Add user (name, email, role) → the one-time password is shown once" and "Issue new password (password accounts only, not one's own) → the person is signed out on every device".
- 6.2 data dictionary: `profiles.password_account`, `profiles.must_change_password`; table `password_handovers` (user_id, temp_hash, issued_by, issued_at — no client access).
- 6.4 functions: revised `is_allowed_user()`, `my_access_status()` (adds `must_change_password`); new `admin_register_password_account`, `admin_mark_password_reset`, `finish_password_change`.

- [ ] **Step 4: Design document (HTML)**

In `docs/design/spec-sheet-editor-design.html`, add a short notice right after the document title block:
"Version 1.2 (08/10/2026) changes sign-in to email and password for accounts an Admin creates; Google
sign-in follows later. The Markdown edition carries the updated BR-08, F-01, F-30, UC-01 and UC-13."
Use the page's existing note/callout styling.

- [ ] **Step 5: Roadmap**

In `docs/plans/2026-10-07-spec-sheet-editor-roadmap.md`:
- Prerequisite 1: replace the Google provider and "Allow new users to sign up" bullets with the README
  wording above (Email on, sign-ups off, Google later).
- M1 exit criteria: replace "manual sign-in with a `ctyhp.vn` account and rejection of a gmail account"
  with "manual sign-in with the first Admin's one-time password, forced password change, a second
  account created in Admin → Users, and a wrong password refused".
- Add under the milestone table: "**Change 2026-10-08:** password sign-in for accounts an Admin creates
  (plan `2026-10-08-password-sign-in.md`); Google sign-in moves to a later milestone and will run side
  by side. Part of UC-13 (create accounts, issue passwords) moves forward from M6."

- [ ] **Step 6: Commit**

```bash
git add README.md
git add .env.example
git add docs/design/spec-sheet-editor-design.md
git add docs/design/spec-sheet-editor-design.html
git add docs/plans/2026-10-07-spec-sheet-editor-roadmap.md
git commit -m "docs: password sign-in in setup, design and roadmap"
```

---

## After the tasks

1. Whole-branch review; fix what it finds.
2. Owner, in Supabase: Authentication → Sign In / Providers → turn off "Allow new users to sign up";
   keep Email on.
3. Owner runs `npm run admin:create -- <their email> "<their name>"` and signs in on
   `http://localhost:3000/login`: one-time password → forced change → sheets; then Admin → Users:
   create a second account, sign in with it in a private window, and try a wrong password.
4. Owner sets the GitHub secret `DATABASE_URL`; then CI is changed to fail (not warn) when SQL tests
   are skipped on a push to `main`.
