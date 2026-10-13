# Logo and Sheet List Paging Implementation Plan

> Work through the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app gets its own logo (option B, approved by the owner on 2026-10-12: a ring with a measured
diameter). The sheet list (`/sheets`) moves from "load 50 more on scroll" to numbered pages, like the Admin
area.

**Architecture:**
- **The logo** is one SVG component, `src/ui/logo.tsx`, with fixed brand colours, like an app icon. It is used in
  the header and on the sign-in page. Next.js file-based metadata serves `src/app/icon.svg` (the browser tab
  icon) and `src/app/apple-icon.tsx` (a 180 px PNG generated with `next/og`, so no binary is committed).
- **The sheet list:**
  - It reads the `sheet_list` view (security invoker, RLS applies) with an exact count first, then one `.range()`
    of the clamped page, the same way `fetchTrashPage` does. There is no migration.
  - The tab, the search and the page live in the URL (`?tab=trash&q=…&page=2&size=25`), so the page is server
    rendered and Back/Forward work.
  - Only the shown page's thumbnails are signed.
  - The shared `Pagination` component moves from `src/app/(app)/admin/ui/` to `src/ui/`, so both areas use it.

**Tech Stack:** Next.js 16.3.8 (server components, file-based metadata, `next/og`), React 19.2, Tailwind CSS 4,
`lucide-react` 1.48.0, Vitest 4, Playwright 1.63.

## Global Constraints

- Repo is **public**: never commit `.env.local`, real sheets, SO/MO numbers, passwords or keys.
  - Stage files one by one by path. Never use `git add -f`, `git add -A` or `git add .`; git-ignored local scratch files must never be committed.
- File names, commit messages and documents are in English. The only Vietnamese text is interface copy in
  `src/messages/vi.ts`, plus the language's name on the VI/EN switch. End-to-end tests may match Vietnamese UI
  text in regular expressions.
- Commits carry no attribution trailer of any kind and no tool names.
- Every user-facing string goes in both dictionaries, with the same keys and placeholders.
- No migration. RLS and the database functions are unchanged.
- The sheet list must work from a 360 px wide screen (NFR-06), including its pagination.
- Contrast: text at least 4.5:1, non-text at least 3:1, in light and dark mode.
- The CSP (`src/lib/security/csp.ts`) is unchanged. Everything new is same-origin.
- Unit tests: `npx vitest run tests/unit`. Also run `npm run lint`, `npm run typecheck` and `npm run build`.
- **End-to-end tests run against production.** Never start a Playwright run yourself. The controller runs the named
  specs after asking the owner.

## The logo (option B)

The geometry, in a 64 × 64 viewBox, is the approved mockup:

```svg
<rect width="64" height="64" rx="14" fill="#1d6b4b"/>
<circle cx="32" cy="35" r="15" fill="none" stroke="#fff" stroke-width="4"/>
<path d="M27 16.5l5-6 5 6z" fill="#fff"/>
<path d="M17 35h30" stroke="#9fe1cb" stroke-width="2.5"/>
<path d="M20.5 32l-3.5 3 3.5 3M43.5 32l3.5 3-3.5 3" fill="none" stroke="#9fe1cb" stroke-width="2"/>
<path d="M12 31v8M52 31v8" stroke="#9fe1cb" stroke-width="2.5"/>
```

Below 32 px the detail is simplified, as in the mockup's small version:
- the ring is 5 wide;
- the stone is `M27 17l5-6 5 6z`;
- the measure is one line `M14 35h36`, 3.5 wide, with no arrowheads and no extension ticks.

The colours are fixed (brand): tile `#1d6b4b`, ring and stone `#ffffff`, measure `#9fe1cb`. They are the same in
dark mode. On the dark header, the tile keeps a hairline of `rgba(255,255,255,0.12)` so its edge stays visible.

---

### Task 1: The logo

**Files:**
- Create: `src/ui/logo.tsx`, `src/app/icon.svg`, `src/app/apple-icon.tsx`, `tests/unit/logo.test.ts`
- Modify: `src/ui/app-header.tsx`, `src/app/login/page.tsx`, the dictionaries if a label is needed

**Requirements:**
- `Logo({ size, title }: { size: number; title?: string })`:
  - an inline SVG that uses the detailed geometry from 32 px up and the simplified one below;
  - `aria-hidden` when `title` is absent (decorative beside visible text); otherwise `role="img"` with a
    `<title>`.
- **Header:** the home link shows the logo at 28 px before "Spec Sheet Editor". The link keeps its text, so the
  logo is decorative there.
- **Sign-in page:** the logo at 48 px above the app name in the card.
- **`src/app/icon.svg`:** the simplified 64 × 64 mark as a static file. Next.js links it as the tab icon.
- **`src/app/apple-icon.tsx`:** `export const size = { width: 180, height: 180 }`, `contentType = "image/png"`,
  and an `ImageResponse` from `next/og` that draws the detailed mark full-bleed. Read the Next.js 16 docs in
  `node_modules/next/dist/docs/` for the file conventions before writing it.
- Unit test `tests/unit/logo.test.ts`:
  - `src/app/icon.svg` parses as XML, has `viewBox="0 0 64 64"` and contains the three colours;
  - the `Logo` component's geometry helper (if you extract one) returns the detailed or simplified paths
    around 32 px.
- Run `npm run build` and confirm that the route table lists `/icon.svg` and `/apple-icon`, and that the bundle
  check still passes.

- [ ] Steps: write the test, see it fail; implement; run the unit tests, lint, typecheck and build.
- [ ] **Commit:** `feat(ui): the app logo in the header, on the sign-in page and as the browser and home-screen icon`.

### Task 2: Numbered pages on the sheet list

**Files:**
- Move: `src/app/(app)/admin/ui/pagination.tsx` and `pagination-view.tsx` to `src/ui/`, and update every import.
- Modify:
  - `src/sheets/queries.ts` (+ `fetchSheetPageNumbered`, then remove `fetchSheetPage`/`loadSheets` and `Cursor`
    if nothing else uses them)
  - `src/sheets/actions.ts`
  - `src/app/(app)/sheets/page.tsx`, `src/app/(app)/sheets/sheet-list.tsx`
  - the dictionaries (remove `loadMore` if unused)
- Test: `tests/unit/sheet-paging.test.ts`

**Interfaces:**
- `fetchSheetPageNumbered(tab: SheetTab, query: string, page: number, size: number): Promise<{ rows: SheetRow[]; total: number; page: number }>`:
  - an exact head count on `sheet_list` with the same filters;
  - `pageRead` from `src/admin/paging.ts` to clamp;
  - one `.range()` ordered like `list_sheets`: `updated_at` (live) or `deleted_at` (trash), descending, then
    `id` descending;
  - thumbnails signed only for these rows, in one batch.
- Search filter: case-insensitive "contains" on `name`, with `%`, `_` and `\` in the user's text escaped, as
  `list_sheets` does. Put the escaping in a pure helper with a unit test. PostgREST's `ilike` takes `%` wildcards
  through supabase-js; check what reaches PostgREST for a text containing `%`, `_`, `*` and `,`, and make each
  match literally.

**Requirements:**
- `page.tsx` reads `tab` (`live` | `trash`), `q`, `page` and `size` from `searchParams`, with `parsePaging` for
  the last two. It fetches the page on the server and passes rows, counts and the `PageInfo` to `SheetList`.
- `SheetList`:
  - The tabs are links that keep `q` and reset `page`.
  - The search box updates the URL with `router.replace` 300 ms after typing, which resets `page` to 1.
  - The infinite scroll, the IntersectionObserver and "Load more" are removed.
  - `Pagination` (link mode) sits under the list, with "Showing a–b of n".
  - Trash, Restore and Undo work as today. After an action, the page refreshes (`router.refresh()` or the
    action's revalidation), and the existing "moved to the Trash" status with Undo still shows.
  - The empty and no-match states stay.
- `Pagination` must fit at 360 px: the controls wrap under the "Showing" text, and every control is at least
  24 × 24 px.
- Keyboard: Tab order is search, tabs, rows, pagination. The previous/next links are real links.

- [ ] Steps:
  - Write `tests/unit/sheet-paging.test.ts` for the escaping helper and for the URL builder (tab, q, page, size
    kept or reset correctly). See it fail.
  - Implement.
  - Run the unit tests, lint, typecheck and build.
- [ ] **Commit:** `feat(sheets): numbered pages on the sheet list, with the tab, search and page in the URL`.

### Task 3: Tests, guide and docs

**Files:**
- Modify:
  - `e2e/list.spec.ts`: TC-52 walks the pages. It seeds 1,120, searches the prefix, sets the size to 50, follows
    "Next page" to the last page, and checks "Showing 1101–1120 of 1120". TC-48 adapts to the URL-driven list.
  - `e2e/a11y.spec.ts`, `e2e/keyboard.spec.ts`, `e2e/csp.spec.ts`, `e2e/session.spec.ts`: TC-53 at 360 px checks
    that the pagination does not cause a horizontal scroll.
  - `e2e/guide/shots.capture.ts`: the list shot targets are still valid. Keep the own-rows guard.
  - the guide copy: "Find sheets" now describes pages instead of scrolling;
  - `README.md` and `docs/design/spec-sheet-editor-design.md`: the sheet list pages, the logo files.
- Type-check every spec. Do not run them.

- [ ] **Commit:** `test(sheets): page-based list tests and guide copy`.

After Task 3 the controller asks the owner for a time, then runs:
1. `timeout 2700 npx playwright test e2e/list.spec.ts e2e/a11y.spec.ts e2e/keyboard.spec.ts e2e/csp.spec.ts e2e/session.spec.ts e2e/upload.spec.ts e2e/guide.spec.ts`
2. `timeout 1200 npm run guide:shots`

Then the controller looks at the screenshots of the header, the sign-in page, the tab icon and the sheet list,
at 1440 and 360 px, in both themes.
