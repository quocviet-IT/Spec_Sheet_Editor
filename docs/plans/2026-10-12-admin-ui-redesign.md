# Admin Area Redesign Implementation Plan

> Work through the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four Admin pages (Users, Access, Audit log, Trash) share one professional structure: icons, a page
header, tabs, tables with badges, a row action menu, dialogs for forms, and pagination. The reserved test
accounts are hidden.

**Architecture:**
- Pure helpers carry the logic and are unit-tested: paging, relative time, the users filter and the audit page
  range.
- A small set of shared components lives in `src/app/(app)/admin/ui/`. Each page is rebuilt on them, one task per
  page.
- The existing server actions, database functions, confirmations and messages are reused unchanged. Only the
  audit and trash reads gain page-based variants.

**Tech Stack:** Next.js 16.3.8 (server components, server actions), React 19.2, Tailwind CSS 4 with the tokens
in `src/app/globals.css`, `lucide-react` 1.48.0 (new, exact version), Vitest 4, Playwright 1.63,
`@axe-core/playwright` 4.13.0.

**Spec:** `docs/design/2026-10-12-admin-ui-redesign.md` (approved 2026-10-12). Read it first. Its "Pages" and
"Shared components" sections are the requirements of Tasks 2–6.

## Global Constraints

- Repo is **public**: never commit `.env.local`, real sheets, SO/MO numbers, passwords or keys.
  - Stage files one by one (`git add <path>`).
  - Grep the staged diff for `SO2`, `MO2` and `sb_secret_` before each commit.
- File names, commit messages and documents are in English. The only Vietnamese text is interface copy in
  `src/messages/vi.ts`, plus the language's name on the VI/EN switch. End-to-end tests may match Vietnamese UI
  text in regular expressions.
- Commits carry no attribution trailer of any kind: no Co-Authored-By lines and no tool names.
- Every user-facing string goes in both `src/messages/vi.ts` and `src/messages/en.ts`, with the same keys and the
  same placeholders. `tests/unit/messages.test.ts` enforces this.
- Invisible characters (byte order mark, bidirectional marks) are written only as `\u` escapes.
- No migration. Applied migrations are never edited. The database functions and RLS are unchanged.
- Every Admin page, server action and route handler still calls `requireAdmin()` itself.
- Times are shown in `Asia/Ho_Chi_Minh`.
- Icons come only from `lucide-react` 1.48.0, installed with `npm install -E lucide-react@1.48.0`. If an icon
  named in this plan does not exist in that version, use the closest one and list the swap in the report.
  - Decorative icons get `aria-hidden`. Icon-only buttons get an `aria-label` from the dictionaries.
  - Sizes: 16 px in tables and buttons, 18 px in tabs, 20 px beside titles.
- Colours come only from the tokens in `src/app/globals.css`, in both light and dark mode. Contrast: text at
  least 4.5:1, non-text at least 3:1.
- The Table B.1 messages, the confirmations ("{n} accounts will lose access. Continue?", the typed-name permanent
  deletion) and the existing error messages stay word for word.
- Unit tests: `npx vitest run tests/unit`. Also run `npm run lint`, `npm run typecheck` and `npm run build`.
- **End-to-end tests run against production by the owner's decision** (spec, Testing).
  - Never start a Playwright run on your own. When a task's step says "e2e", stop and report back; the controller
    asks the owner for a quiet time, switches `E2E_DEV_PROJECT_REF` on in `.env.local`, and runs the named specs.
  - Run only the named specs, never the full suite.
- Before calling a UI task done, the controller takes screenshots in both languages and both themes and looks at
  them.

## File structure

| File | Responsibility |
|---|---|
| `src/admin/paging.ts` | Page sizes, parsing `?page`/`?size`, page arithmetic, the `range()` bounds (pure) |
| `src/lib/relative-time.ts` | "2 days ago" in vi/en, with a date after 30 days (pure) |
| `src/admin/users-filter.ts` | Accent-insensitive search plus role and status filters for the users list (pure) |
| `src/app/(app)/admin/ui/*.tsx` | PageHeader, AdminTabs, StatCards, Badge, RowMenu, Pagination, EmptyState, Dialog, RelativeTime |
| `src/app/(app)/admin/users/*` | Users page on the new components |
| `src/app/(app)/admin/access/*` | Access page on the new components |
| `src/app/(app)/admin/audit/*` | Audit page, paged on the server |
| `src/app/(app)/admin/trash/*` | Trash page, paged on the server |
| `src/admin/queries.ts` | + `fetchAuditPage`, `fetchTrashPage` |

---

### Task 1: Foundations — icons, tokens and the pure helpers

**Files:**
- Create:
  - `src/admin/paging.ts`, `src/lib/relative-time.ts`, `src/admin/users-filter.ts`
  - `tests/unit/admin-paging.test.ts`, `tests/unit/relative-time.test.ts`, `tests/unit/admin-users-filter.test.ts`
- Modify:
  - `package.json` and `package-lock.json` (the `lucide-react` 1.48.0 dependency)
  - `src/app/globals.css` (tokens `--success`, `--success-soft`, `--admin`, `--admin-soft` in both themes, and
    their `@theme inline` colours)
  - `src/app/(app)/admin/users/users-table.tsx` (import `fold` from `users-filter.ts` instead of defining it)

**Interfaces:**
- Produces:
  - `PAGE_SIZES: readonly [10, 25, 50]` and `DEFAULT_PAGE_SIZE = 25`;
  - `parsePaging(params: Record<string, string | string[] | undefined>): { page: number; size: number }`;
  - `pageInfo(total: number, page: number, size: number): PageInfo`, where
    `PageInfo = { page: number; pages: number; size: number; total: number; from: number; to: number }`.
    `from` and `to` are 1-based for display, and both are 0 when `total` is 0;
  - `rangeOf(page: number, size: number): { from: number; to: number }`, 0-based inclusive bounds for
    `.range()`;
  - `relativeTime(iso: string, now: Date, locale: "vi" | "en"): string`;
  - `fold(s: string): string`;
  - `UserStatusFilter = "all" | "active" | "suspended" | "waiting"`;
  - `filterUsers<T extends FilterableUser>(rows: readonly T[], f: { query: string; role: "all" | "user" | "admin"; status: UserStatusFilter }): T[]`,
    where `FilterableUser = { email: string; fullName: string | null; role: "user" | "admin"; status: "active" | "suspended"; passwordAccount: boolean; mustChangePassword: boolean }`.

- [ ] **Step 1: Write the failing tests.**

`tests/unit/admin-paging.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, pageInfo, parsePaging, rangeOf } from "@/admin/paging";

describe("parsePaging", () => {
  it("defaults to page 1 and the default size", () => {
    expect(parsePaging({})).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE });
  });
  it("accepts only the offered sizes and positive whole pages", () => {
    expect(parsePaging({ page: "3", size: "50" })).toEqual({ page: 3, size: 50 });
    expect(parsePaging({ page: "0", size: "7" })).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE });
    expect(parsePaging({ page: "-2" })).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE });
    expect(parsePaging({ page: "2.5" })).toEqual({ page: 1, size: DEFAULT_PAGE_SIZE });
    expect(parsePaging({ page: ["4", "9"], size: ["10"] })).toEqual({ page: 4, size: 10 });
  });
});

describe("pageInfo", () => {
  it("describes a middle page", () => {
    expect(pageInfo(42, 2, 10)).toEqual({ page: 2, pages: 5, size: 10, total: 42, from: 11, to: 20 });
  });
  it("clamps a page past the end to the last page", () => {
    expect(pageInfo(42, 9, 10)).toEqual({ page: 5, pages: 5, size: 10, total: 42, from: 41, to: 42 });
  });
  it("has one empty page when there is nothing", () => {
    expect(pageInfo(0, 3, 25)).toEqual({ page: 1, pages: 1, size: 25, total: 0, from: 0, to: 0 });
  });
});

describe("rangeOf", () => {
  it("gives the 0-based inclusive bounds for range()", () => {
    expect(rangeOf(1, 25)).toEqual({ from: 0, to: 24 });
    expect(rangeOf(3, 10)).toEqual({ from: 20, to: 29 });
  });
});
```

`tests/unit/relative-time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { relativeTime } from "@/lib/relative-time";

const now = new Date("2026-10-12T10:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("says now under a minute, in Intl's own words", () => {
    const now0 = (loc: string) => new Intl.RelativeTimeFormat(loc, { numeric: "auto" }).format(0, "second");
    expect(relativeTime(ago(20_000), now, "en")).toBe(now0("en-GB"));
    expect(relativeTime(ago(20_000), now, "vi")).toBe(now0("vi-VN"));
  });
  it("counts minutes, hours and days", () => {
    expect(relativeTime(ago(5 * MIN), now, "en")).toBe("5 minutes ago");
    expect(relativeTime(ago(3 * HOUR), now, "en")).toBe("3 hours ago");
    expect(relativeTime(ago(2 * DAY), now, "en")).toBe("2 days ago");
    expect(relativeTime(ago(2 * DAY), now, "vi")).toBe("2 ngày trước");
  });
  it("shows the date from 30 days on, in Vietnam time", () => {
    expect(relativeTime("2026-08-01T20:00:00Z", now, "en")).toBe("02/08/2026");
  });
  it("returns the input for a value that is not a date", () => {
    expect(relativeTime("not a date", now, "en")).toBe("not a date");
  });
});
```

The exact wording comes from `Intl.RelativeTimeFormat` with `numeric: "always"`. If Node's ICU gives a slightly
different Vietnamese string, for example "2 ngày trước" with a different space character, change the expectation
to what `Intl` produces and say so in the report. No Vietnamese text may be written in `src/` outside
`src/messages/vi.ts`, so "now" also comes from `Intl` (`numeric: "auto"`, 0 seconds).

`tests/unit/admin-users-filter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterUsers, fold } from "@/admin/users-filter";

const u = (email: string, fullName: string | null, role: "user" | "admin", status: "active" | "suspended", mustChangePassword = false) =>
  ({ email, fullName, role, status, passwordAccount: true, mustChangePassword });
const rows = [
  u("admin@ctyhp.vn", "Quản trị viên", "admin", "active"),
  u("intern1@ctyhp.vn", "Tạ Quốc Việt", "user", "active"),
  u("sx01@ctyhp.vn", "TLKT 1", "user", "active", true),
  u("old@ctyhp.vn", "Đặng Cũ", "user", "suspended"),
];
const all = { query: "", role: "all" as const, status: "all" as const };

describe("filterUsers", () => {
  it("keeps everyone with no filter", () => {
    expect(filterUsers(rows, all)).toHaveLength(4);
  });
  it("searches name and email without accents", () => {
    expect(filterUsers(rows, { ...all, query: "quoc viet" }).map((r) => r.email)).toEqual(["intern1@ctyhp.vn"]);
    expect(filterUsers(rows, { ...all, query: "dang" }).map((r) => r.email)).toEqual(["old@ctyhp.vn"]);
    expect(filterUsers(rows, { ...all, query: "SX01" }).map((r) => r.email)).toEqual(["sx01@ctyhp.vn"]);
  });
  it("filters by role and by status, waiting meaning a first password not yet set", () => {
    expect(filterUsers(rows, { ...all, role: "admin" }).map((r) => r.email)).toEqual(["admin@ctyhp.vn"]);
    expect(filterUsers(rows, { ...all, status: "suspended" }).map((r) => r.email)).toEqual(["old@ctyhp.vn"]);
    expect(filterUsers(rows, { ...all, status: "waiting" }).map((r) => r.email)).toEqual(["sx01@ctyhp.vn"]);
    expect(filterUsers(rows, { ...all, status: "active" }).map((r) => r.email)).toEqual(["admin@ctyhp.vn", "intern1@ctyhp.vn"]);
  });
  it("combines search and filters", () => {
    expect(filterUsers(rows, { query: "ctyhp", role: "user", status: "active" }).map((r) => r.email)).toEqual(["intern1@ctyhp.vn"]);
  });
});

describe("fold", () => {
  it("lower-cases and strips accents, đ included", () => {
    expect(fold("Đặng Quốc VIỆT")).toBe("dang quoc viet");
  });
});
```

`status: "active"` means active and not waiting for a first password. `waiting` means a password account whose
`mustChangePassword` is true and whose status is active.

- [ ] **Step 2:** Run `npx vitest run tests/unit/admin-paging.test.ts tests/unit/relative-time.test.ts tests/unit/admin-users-filter.test.ts`.
  Expected: FAIL, the modules do not exist.
- [ ] **Step 3: Implement.**

`src/admin/paging.ts`:

```ts
/** Page sizes offered in every Admin table, and the default. */
export const PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 25;

export type PageInfo = { page: number; pages: number; size: number; total: number; from: number; to: number };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** `?page=` and `?size=` from the URL; anything unexpected falls back to page 1 and the default size. */
export function parsePaging(params: Record<string, string | string[] | undefined>): { page: number; size: number } {
  const rawPage = first(params.page);
  const rawSize = Number(first(params.size));
  const page = rawPage && /^[1-9]\d{0,5}$/.test(rawPage) ? Number(rawPage) : 1;
  const size = (PAGE_SIZES as readonly number[]).includes(rawSize) ? rawSize : DEFAULT_PAGE_SIZE;
  return { page, size };
}

/** Which rows a page shows, with the page clamped to the last one; `from` and `to` are 1-based for display. */
export function pageInfo(total: number, page: number, size: number): PageInfo {
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pages);
  if (total === 0) return { page: 1, pages: 1, size, total: 0, from: 0, to: 0 };
  const from = (current - 1) * size + 1;
  return { page: current, pages, size, total, from, to: Math.min(total, current * size) };
}

/** The 0-based inclusive bounds for PostgREST's range(). */
export function rangeOf(page: number, size: number): { from: number; to: number } {
  const from = (Math.max(1, page) - 1) * size;
  return { from, to: from + size - 1 };
}
```

`src/lib/relative-time.ts`:

```ts
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * "now", "5 minutes ago", "2 days ago" (Intl's words in either language), and the date (dd/mm/yyyy, Vietnam time) from 30 days on.
 * Pure: `now` is passed in, so the result is the same on the server and in tests.
 */
export function relativeTime(iso: string, now: Date, locale: "vi" | "en"): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const ms = Math.max(0, now.getTime() - then.getTime());
  const tag = locale === "vi" ? "vi-VN" : "en-GB";
  if (ms < 60_000) return new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(0, "second");
  if (ms >= 30 * DAY_MS) return DATE.format(then);
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "always" });
  if (ms < 60 * 60_000) return rtf.format(-Math.floor(ms / 60_000), "minute");
  if (ms < DAY_MS) return rtf.format(-Math.floor(ms / (60 * 60_000)), "hour");
  return rtf.format(-Math.floor(ms / DAY_MS), "day");
}
```

`src/admin/users-filter.ts`:

```ts
export type UserStatusFilter = "all" | "active" | "suspended" | "waiting";
export type FilterableUser = {
  email: string;
  fullName: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  passwordAccount: boolean;
  mustChangePassword: boolean;
};

/** Lower-case text without accents, so "nhan" finds "Nhân". */
export function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");
}

const waiting = (r: FilterableUser) => r.status === "active" && r.passwordAccount && r.mustChangePassword;

/** The users list after search (name or email, accents ignored), role and status; order is kept. */
export function filterUsers<T extends FilterableUser>(rows: readonly T[], f: { query: string; role: "all" | "user" | "admin"; status: UserStatusFilter }): T[] {
  const needle = fold(f.query.trim());
  return rows.filter((r) => {
    if (needle && !fold(r.email).includes(needle) && !fold(r.fullName ?? "").includes(needle)) return false;
    if (f.role !== "all" && r.role !== f.role) return false;
    if (f.status === "suspended") return r.status === "suspended";
    if (f.status === "waiting") return waiting(r);
    if (f.status === "active") return r.status === "active" && !waiting(r);
    return true;
  });
}
```

- [ ] **Step 4:** Run the three tests. Expected: PASS. Replace the local `fold` in `users-table.tsx` with the
  import from `@/admin/users-filter`.
- [ ] **Step 5: Install the icons and add the tokens.**
  - Run `npm install -E lucide-react@1.48.0`.
  - In `src/app/globals.css`, add `--success`, `--success-soft`, `--admin` and `--admin-soft` in `:root`, in the
    dark block, and in `@theme inline` (`--color-success` and so on). Choose them so that `--success` and
    `--admin` text on their `-soft` background, and on `--surface`, are at least 4.5:1 in both themes.
  - Use a small throwaway script to compute the ratios, and put them in the report.
  - Suggested starting points: light `--success #1f7a45` on `#e3f3e9`, `--admin #5b3fb5` on `#ece8fb`; dark
    `--success #6fd39a` on `#14301f`, `--admin #b9a6ff` on `#251c45`. Adjust until they pass.
- [ ] **Step 6:** Run `npx vitest run tests/unit`, `npm run lint`, `npm run typecheck` and `npm run build`.
  Expected: all pass.
- [ ] **Step 7: Commit:** `feat(admin): paging, relative time and users-filter helpers, the icon set and two badge colours`.

### Task 2: Shared Admin components

**Files:**
- Create in `src/app/(app)/admin/ui/`:
  - `page-header.tsx`, `admin-tabs.tsx` (client), `stat-cards.tsx`, `badge.tsx`
  - `row-menu.tsx` (client), `pagination.tsx`, `empty-state.tsx`, `dialog.tsx` (client), `relative-time.tsx`
- Modify:
  - `src/app/(app)/admin/layout.tsx` (use `AdminTabs`)
  - delete `src/app/(app)/admin/admin-nav.tsx`
  - the dictionaries (`admin.ui.*` and `admin.areas` lead texts)

**Interfaces:**
- Consumes: Task 1 (`pageInfo`, `PAGE_SIZES`, `relativeTime`), `lucide-react`.
- Produces:
  - `PageHeader({ icon: LucideIcon; title: string; lead: string; action?: ReactNode })`. It renders the
    breadcrumb "Admin › {title}" and an `<h1>`.
  - `AdminTabs()`. It has the same four links as today's `AdminNav`, each with an icon: `Users`, `ShieldCheck`,
    `History`, `Trash2`. It sets `aria-current="page"`.
  - `StatCards({ items: { icon: LucideIcon; label: string; value: number }[] })`.
  - `Badge({ tone: "neutral" | "accent" | "success" | "warning" | "danger" | "admin"; icon?: LucideIcon; children })`.
  - `RowMenu({ label: string; items: RowMenuItem[] })`, where
    `RowMenuItem = { key: string; label: string; icon: LucideIcon; onSelect: (opener: HTMLElement) => void; tone?: "danger"; separatorBefore?: boolean }`.
    `label` is the button's accessible name, for example "Actions for {name}".
  - `Pagination(props)`, in one of two modes: `{ info: PageInfo; hrefFor: (page: number, size: number) => string }`
    (server pages) or `{ info: PageInfo; onChange: (page: number, size: number) => void }` (client lists).
  - `EmptyState({ icon: LucideIcon; title: string; hint?: string })`.
  - `Dialog({ title: string; open: boolean; onClose: () => void; children })`.
  - `RelativeTime({ iso: string })`, rendered with `<time dateTime={iso} title={exact}>`. It is a client component
    computing `relativeTime(iso, new Date(), locale)` after mount; before mount it shows the exact time, so the
    server and client markup match and there is no hydration warning.

**Requirements** (spec, "Shared components"; follow it exactly):
- `RowMenu` follows the WAI-ARIA menu button pattern:
  - the button carries `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`;
  - the menu has `role="menu"` and its items `role="menuitem"`;
  - Enter, Space or ArrowDown opens the menu on the first item, and ArrowUp opens it on the last;
  - ArrowUp and ArrowDown wrap, and Home and End jump;
  - Esc closes and refocuses the button, and so do Tab and a click outside;
  - selecting an item calls `onSelect(button)` after closing, so dialogs can return focus to the button.
  - The menu is positioned under the button, right-aligned, inside the table's scroll container, and it must not
    be clipped. If the table wrapper is `overflow-x-auto`, open the menu upwards when there is no room below, or
    render it in a portal; pick one and explain it in a comment.
  - Danger items use `text-danger`. A separator is `role="separator"`.
- `Dialog` reuses the pattern of the existing dialogs: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus on
  the first field, Tab trapped, Esc closes, focus returns to the element that opened it. Find the closest
  existing implementation (for example `src/app/(app)/sheets/[id]/conflict-dialog.tsx` or the confirm dialog in
  `users-table.tsx`) and copy its approach rather than inventing a new one.
- `Pagination` shows:
  - "Showing {from}–{to} of {total}" (`admin.ui.showing`);
  - a size `<select>` labelled "Rows per page" (`admin.ui.rowsPerPage`) with `PAGE_SIZES`;
  - previous and next buttons with `aria-label`s, disabled at the ends (the one allowed use of disabled);
  - "Page {page} of {pages}".

  In link mode the previous and next controls are `<Link>`s, and the size select is a small GET form, so it
  works without JavaScript.
- `admin.areas` gets the icons. The tab labels are unchanged.
- New dictionary keys, both languages:
  - `admin.ui.breadcrumb` ("Admin" / "Quản trị");
  - `admin.ui.showing` ("Showing {from}–{to} of {total}" / "Hiển thị {from}–{to} trong {total}");
  - `admin.ui.rowsPerPage`;
  - `admin.ui.previous`, `admin.ui.next`;
  - `admin.ui.pageOf` ("Page {page} of {pages}" / "Trang {page}/{pages}");
  - `admin.ui.actionsFor` ("Actions for {name}" / "Thao tác cho {name}");
  - `admin.ui.close`.

- [ ] **Step 1:** Install nothing new. Write the components, with doc comments stating what each renders and its
  accessibility contract.
- [ ] **Step 2:** Swap `AdminNav` for `AdminTabs` in the layout, and delete `admin-nav.tsx`. Search for any other
  import of it: `grep -rn "admin-nav" src e2e`.
- [ ] **Step 3:** Run `npx vitest run tests/unit` (the messages test covers the new keys), `npm run lint`,
  `npm run typecheck` and `npm run build`. Expected: all pass.
- [ ] **Step 4: Commit:** `feat(admin): shared header, tabs, badges, row menu, dialog, pagination and relative time`.

### Task 3: Users page

**Files:**
- Modify: `src/app/(app)/admin/users/page.tsx`, `users-table.tsx`, `add-user-form.tsx`, the dictionaries
- Modify: `e2e/admin.spec.ts` (`changeUser`), `e2e/guide/shots.capture.ts` (the `admin-users` shot's targets)
- Test: `tests/unit/admin-test-accounts.test.ts`, unchanged

**Requirements** (spec, Pages → Users):
- `page.tsx`:
  - It reads `searchParams`. The test accounts are shown only when `show === "test"`; otherwise only `people`
    are passed to the table. The page still calls `requireAdmin` first.
  - The `<details>` "Test accounts" section is removed.
  - It renders a `PageHeader` with `Users` and the "Add user" button, which opens the `Dialog` with the existing
    `AddUserForm`. The dialog closes after an account is created, and the one-time password panel
    (`issued-password.tsx`) still shows.
  - It renders `StatCards` (`Users`, `CircleCheck`, `Ban`, `ShieldCheck`) counted over the rows shown.
- `users-table.tsx`:
  - Keep the state and actions (`setRole`, `setStatus`, `resetPassword` through the existing components) and the
    `ConfirmDialog`.
  - The toolbar holds the search box with a `Search` icon inside it, plus two `<select>`s: role (all, Admin,
    Staff) and status (all, active, suspended, waiting for a first password). They feed `filterUsers`.
  - Pagination is client-side with `pageInfo` and `Pagination` in `onChange` mode, 25 rows by default. It returns
    to page 1 when the search or a filter changes.
  - Columns: User, Role, Status, Last active, Sheets, and an empty header for actions with an `sr-only` label.
    - **User:** an initials avatar (accent tint for Admins, neutral for Staff), the name, "(you)", and the email
      with a `KeyRound` or `Globe` icon for the sign-in method, whose `aria-label` names it.
    - **Role:** `Badge` admin `ShieldCheck` or neutral `User`.
    - **Status:** `Badge` success "Active", danger `Ban` "Suspended", or warning `Clock` "Waiting for a first
      password". The old separate yellow tag is gone.
    - **Last active:** `RelativeTime`, or "Never signed in".
  - Actions: a `RowMenu` labelled `actionsFor` with the person's name, or the email when there is no name. Its
    items:
    - Make Admin / Make Staff (`ShieldPlus` / `ShieldMinus`);
    - Issue new password (`KeyRound`, password accounts only), opening the existing reset flow;
    - a separator;
    - Suspend (`Ban`, danger) or Reinstate (`RotateCcw`).

    The person's own row has no Suspend item, as today.
  - `EmptyState` (`SearchX`) when no row matches, and (`Users`) when there is no one.
- Dictionary keys for the new labels: filters, the waiting status, "Never signed in" (if not already there), and
  the column header for actions.
- `e2e/admin.spec.ts`:
  - `changeUser` goes to `/admin/users?show=test`.
  - It opens the row menu by its accessible name, `/(Thao tác cho|Actions for) E2E Staff B/`, and chooses the
    menu item by role `menuitem` and its label. The confirm dialog part is unchanged.
  - Replace the earlier "open the Test accounts section" line.
  - Update `ROW_OF` if a row's text changed.
- `e2e/guide/shots.capture.ts`: update the `admin-users` shot so its callouts point at: the Add user button, the
  search and filters, a row's status badge, and a row's "⋯" button. Use `?show=test` only if it needs a second
  row; prefer showing only real-looking test rows that the capture already creates, and no real person.

- [ ] **Step 1:** Implement the page and the table. Run `npx vitest run tests/unit`, `npm run lint`,
  `npm run typecheck` and `npm run build`. Expected: pass.
- [ ] **Step 2:** Update `admin.spec.ts` and the guide capture. Run `npm run typecheck`. These are e2e files: do
  not run them. Report that they are ready for the controller's e2e run.
- [ ] **Step 3: Commit:** `feat(admin): the Users page on the new header, filters, badges, row menu and pagination; test accounts hidden`.

### Task 4: Access page

**Files:**
- Modify: `src/app/(app)/admin/access/page.tsx`, `access-lists.tsx`, `settings-form.tsx`, the dictionaries;
  `e2e/admin.spec.ts` (the access-list test's selectors)

**Requirements** (spec, Pages → Access):
- `PageHeader` with `ShieldCheck`, and no page action.
- Two cards:
  - **Permitted domains** (`Globe`) and **Permitted emails** (`Mail`). Each card header has an "Add" button
    (`Plus`) that opens a `Dialog` with the existing add form, its validation and its messages.
  - Each card body is a table with these columns: entry; note; Google accounts admitted (`Badge`); added
    (`RelativeTime`); and a `RowMenu` with a single item, Remove (`Trash2`, danger). Remove keeps the existing
    "{n} accounts will lose access. Continue?" confirmation and the self-lockout message.
  - When a list is empty, show an `EmptyState`.
- Settings card (`SlidersHorizontal`):
  - the four settings as rows, each with an icon (`FileUp` max file size, `ImageDown` low-resolution warning,
    `Ratio` ratio tolerance, `Timer` link lifetime), the label, the range hint, the input and the unit;
  - one Save button, as today, keeping the existing range messages.
- `e2e/admin.spec.ts`:
  - the "Access lists" test and TC-64-related steps open the Add dialog and use the row menu's Remove;
  - TC-66 and TC-67 find the settings inputs by their labels, as today.

  Do not run the e2e tests; report that they are ready.

- [ ] **Step 1:** Implement. Run the unit tests, lint, typecheck and build. Expected: pass.
- [ ] **Step 2:** Update `admin.spec.ts` and run `npm run typecheck`.
- [ ] **Step 3: Commit:** `feat(admin): the Access page as two list cards with dialogs and a settings card`.

### Task 5: Audit log, paged on the server

**Files:**
- Modify:
  - `src/admin/queries.ts` (+ `fetchAuditPage`; remove `fetchAudit` once nothing uses it)
  - `src/app/(app)/admin/audit/page.tsx`
  - the dictionaries
  - `e2e/admin.spec.ts`, only where it relied on "Load more" or the old layout
- Test: `tests/unit/admin-paging.test.ts`, extended if needed

**Interfaces:**
- Produces:
  `fetchAuditPage(filter: AuditFilter, upto: number | null, page: number, size: number): Promise<{ rows: AuditRow[]; total: number; upto: number | null }>`.
  - `upto` is the pinned newest id. When the caller passes null, the function reads `maxAuditId(filter)` and
    returns it.
  - Rows are `id <= upto`, newest first, read with `.range(rangeOf(page, size))`.
  - `total` is `countAudit(filter, upto)`.

**Requirements** (spec, Pages → Audit log):
- The URL carries `page`, `size` and `upto` alongside the existing filter query from `filterQuery(filter)`.
  - Changing a filter drops `page` and `upto`, so a new snapshot starts.
  - The Pagination `hrefFor` keeps the filter and `upto`.
  - The CSV link stays as it is: "Download CSV" with the `Download` icon, at the right of the toolbar.
- Parse `upto` like the old `parseBefore`: a positive safe integer, or null.
- The toolbar holds the existing filter form in one wrapping row. Each field gets a leading icon: `CalendarRange`,
  `User`, `ListFilter`, `FileText`.
- Table columns:
  - Time: `RelativeTime` plus the exact time in small text;
  - Person: avatar and name or email;
  - Action: an icon per group plus the readable label already used. Icons per group: upload `Upload`, save
    `Save`, export `Download`, trash `Trash2`, restore `RotateCcw`, purge `Eraser`, sign-in `LogIn`, user change
    `UserCog`, access `ShieldCheck`, settings `SlidersHorizontal`, maintenance `Wrench`. Unknown actions get
    `Activity`. Base the grouping on `AUDIT_GROUPS` in `src/admin/audit-filter.ts`;
  - Target;
  - Details, expandable as today.
- `EmptyState` (`History`) for no entries.
- Keep the "too many results" message and its limit.

- [ ] **Step 1:** Write a unit test for any new pure helper you add, for example the action-to-icon mapping
  keyed by action name: every action in `AUDIT_GROUPS` maps to a known icon key. Run it. Expected: fail.
  Implement. Expected: pass.
- [ ] **Step 2:** Implement `fetchAuditPage` and the page. Run the unit tests, lint, typecheck and build.
  Expected: pass.
- [ ] **Step 3: Commit:** `feat(admin): the audit log with numbered pages over a pinned snapshot, action icons and a toolbar`.

### Task 6: Trash, paged on the server

**Files:**
- Modify:
  - `src/admin/queries.ts` (+ `fetchTrashPage`; keep `fetchTrash` only if something else uses it)
  - `src/app/(app)/admin/trash/page.tsx`, `trash-table.tsx`, `orphan-panel.tsx`
  - the dictionaries
  - `e2e/admin.spec.ts` (TC-74 and TC-76 selectors)

**Interfaces:**
- Produces: `fetchTrashPage(page: number, size: number): Promise<{ rows: TrashRow[]; total: number }>`.
  - Exact count with `select(..., { count: "exact" })`.
  - One `.range(rangeOf(page, size))`, ordered as today.
  - Thumbnails signed only for that page.

**Requirements** (spec, Pages → Trash):
- `PageHeader` with `Trash2`.
- Table columns:
  - thumbnail;
  - sheet name;
  - deleted by (avatar and name);
  - deleted (`RelativeTime`);
  - a `RowMenu` with Restore (`RotateCcw`), a separator, and Delete permanently (`Trash2`, danger), which opens
    the existing `PurgeDialog`. The typed name check and the focus behaviour after purge are unchanged.
- Server pagination via `?page`/`?size`. After a purge or restore, the current page re-renders (the existing
  revalidation). If the page is now past the end, `pageInfo` clamps it.
- The orphan clean-up becomes a card (`FolderX`) below the table, with the same behaviour and messages.
- `EmptyState` (`Trash2`) "The Trash is empty".
- `e2e/admin.spec.ts`: TC-74 opens the row menu for the test sheet and chooses Delete permanently. TC-76 is
  unchanged except for selectors, if the orphan panel's structure changed. Do not run; report.

- [ ] **Step 1:** Implement. Run the unit tests, lint, typecheck and build. Expected: pass.
- [ ] **Step 2: Commit:** `feat(admin): the Trash page with numbered pages, thumbnails and a row menu`.

### Task 7: Accessibility, keyboard, guide copy and screenshots, docs

**Files:**
- Modify:
  - `e2e/a11y.spec.ts`: scan every Admin page in both themes, and once each with a row menu open and with a dialog
    open (Add user, Add domain);
  - `e2e/keyboard.spec.ts`: on `/admin/users?show=test`, Tab to a row's "⋯", open it with Enter, move with
    ArrowDown, close with Esc, and check focus is back on the button;
  - `e2e/csp.spec.ts`, if its Admin visits need selectors;
  - the guide copy in the dictionaries (`guide.*` Admin section): now "open the ⋯ menu on the row", and the
    names of the buttons;
  - `README.md`: the Admin section, briefly;
  - `docs/design/spec-sheet-editor-design.md`: in the Admin sections, point to the redesign spec instead of
    describing the old buttons.

**Requirements:**
- The copy must match the new UI word for word: menu item labels, filters, "Add user".
- After this task the controller runs, at a time the owner chooses:
  `timeout 2400 npx playwright test e2e/admin.spec.ts e2e/a11y.spec.ts e2e/keyboard.spec.ts e2e/csp.spec.ts e2e/guide.spec.ts`,
  then `timeout 900 npm run guide:shots`. Then the controller looks at the screenshots of every Admin page, in
  both languages and both themes, and at the re-captured guide images.

- [ ] **Step 1:** Make the changes. Run the unit tests, lint, typecheck and build. Expected: pass.
- [ ] **Step 2: Commit:** `test(admin): accessibility and keyboard checks for menus and dialogs; guide copy and docs for the new Admin area`.
