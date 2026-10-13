# Header Redesign Implementation Plan

> Work through the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The header becomes:
- one bar, with icon tabs that show the current page;
- a distinct "Report a problem" button;
- a segmented language switch;
- an account menu that holds the name, the role, Change password and Sign out.

On a phone the tabs move to a scrollable second row. Design: `docs/design/2026-10-13-header-redesign.md`.

**Architecture:**
- `src/ui/app-header.tsx` stays a server component and composes small client parts:
  - `NavTabs` (it needs `usePathname`);
  - `AccountMenu`;
  - the existing `FeedbackButton` and `LanguageSwitch`.
- The rule for which tab is current is a pure function with a unit test.
- The account menu reuses the keyboard helpers of the Admin row menu.

**Tech Stack:** Next.js 16.3.8 (server and client components), React 19.2, Tailwind 4 tokens from `src/app/globals.css`
(`accent`, `accent-soft`, `ink`, `ink-2`, `line`, `surface`, `sunk`, `danger`), `lucide-react` 1.48.0, Vitest 4,
Playwright 1.63.

## Global Constraints

- Repo is **public**: never commit `.env.local`, real sheets, SO/MO numbers, passwords or keys.
  - Stage files one by one by path. Never use `git add -f`, `git add -A` or `git add .`; git-ignored local scratch
    files must never be committed.
- File names, commit messages and documents are in English. The only Vietnamese text is interface copy in
  `src/messages/vi.ts`, plus the language's name on the VI/EN switch. End-to-end tests may match Vietnamese UI text in
  regular expressions.
- Commits carry no attribution trailer of any kind and no tool names.
- Every user-facing string goes in both dictionaries, with the same keys and placeholders.
- From 360 px wide: no horizontal page scroll, and every control is at least 24 × 24 px. Contrast must be at least
  4.5:1 for text and 3:1 for non-text, in light and dark mode. The CSP is unchanged.
- No database change.
- End-to-end tests run against production. Never start a Playwright run; the controller runs them.
- Run `npx vitest run tests/unit`, `npm run lint`, `npm run typecheck` and `npm run build`.

---

### Task 1: The new header

**Files:**
- Create:
  - `src/ui/nav-tabs.tsx` (client)
  - `src/ui/account-menu.tsx` (client)
  - `src/ui/active-tab.ts` (pure)
  - `tests/unit/active-tab.test.ts`
- Modify:
  - `src/ui/app-header.tsx`
  - `src/ui/language-switch.tsx` (segmented look; a `variant: "bar" | "menu"` prop if the menu copy needs a
    different layout)
  - `src/ui/feedback-button.tsx` (the label)
  - the dictionaries

**Interfaces:**
- `export type HeaderTab = "sheets" | "guide" | "feedback" | "admin";`
- `export function activeTab(pathname: string): HeaderTab | null`, where:
  - `/sheets` and `/sheets/...` give `"sheets"`;
  - `/guide...` gives `"guide"`;
  - `/feedback...` gives `"feedback"`;
  - `/admin...` gives `"admin"`;
  - anything else gives `null`;
  - and `/sheetsx` is not `/sheets`: match on a whole path segment.
- `NavTabs({ isAdmin, feedbackUnseen, labels })` renders `<nav aria-label={t.common.mainMenu}>` with one `Link` per
  tab. The current tab carries `aria-current="page"`.
- `AccountMenu({ name, email, role, passwordAccount })` renders the button and the menu. Sign out is a `<form
  action={signOut}>` with a `button role="menuitem"`.

- [ ] **Step 1: Unit test first.** Write `tests/unit/active-tab.test.ts`:
  - `/sheets` → sheets;
  - `/sheets?tab=trash` → sheets (the pathname has no query, but test the bare path);
  - `/sheets/6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f` → sheets;
  - `/guide` → guide;
  - `/feedback` → feedback;
  - `/admin` → admin;
  - `/admin/audit` → admin;
  - `/account/password` → null;
  - `/sheetsx` → null;
  - `/` → null.
- [ ] **Step 2: `active-tab.ts`**, implemented as a segment match: `pathname === "/x" || pathname.startsWith("/x/")`.
- [ ] **Step 3: `nav-tabs.tsx`.**
  - Icons, all 16 px and `aria-hidden`:
    - Sheets `FileText`
    - Guide `BookOpen`
    - Feedback `MessagesSquare`
    - Admin `ShieldCheck`, for Admins only
  - Each tab is `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm min-h-8`.
  - The current tab is `bg-accent-soft text-accent font-medium`; the others are `text-ink-2 hover:bg-sunk
    hover:text-ink`.
  - The Feedback tab keeps the existing red count: a visible number that is `aria-hidden`, plus the sr-only "{n}
    waiting".
  - On mobile (`max-md`) the `nav` is a full-width second row with `overflow-x-auto`, no wrapping, and a hidden
    scrollbar that keeps focus rings visible. It must never widen the page.
- [ ] **Step 4: `account-menu.tsx`.**
  - **The button:**
    - a 32 px round avatar with `initials(name, email)` from `src/admin/row-menu-keys.ts`, plus a `ChevronDown`;
    - `aria-haspopup="menu"`, `aria-expanded`, and `aria-label={fill(t.common.account, { name })}`.
  - **The menu:**
    - an absolutely positioned panel under the button, right-aligned, `z-30`, `w-64`, with the surface, line and
      shadow tokens;
    - a header block: the name (`font-medium`), the email (`text-ink-2 text-sm`), and a role badge reading
      `t.common.roleAdmin` or `t.common.roleStaff`.
  - **Items:**
    - below 768 px only, the language switch (`variant="menu"`);
    - Change password (`KeyRound`), a `Link role="menuitem"`, only when `passwordAccount`;
    - a divider;
    - Sign out (`LogOut`, `text-danger`).
  - **Keyboard and focus:**
    - Use `nextMenuIndex` and `menuReaction` from `src/admin/row-menu-keys.ts`, as `RowMenu` does: Enter, Space and
      ArrowDown open on the first item; ArrowUp opens on the last.
    - Inside the menu, the arrows, Home and End move between the items.
    - Escape and Tab close it; Escape returns focus to the button.
    - A click outside closes it.
    - Opening one menu does not move the page.
  - Read `src/app/(app)/admin/ui/row-menu.tsx` first and keep the same behaviour.
- [ ] **Step 5: `app-header.tsx`.**
  - **Desktop** (`md` and up), one row: the brand, then `NavTabs`, a spacer, `FeedbackButton`, `LanguageSwitch`
    (bar variant) and `AccountMenu`.
  - **Below `md`:**
    - The first row has the brand (`Logo` 28 px; the name stays, truncated if needed), the spacer, `FeedbackButton`
      with its icon only, and `AccountMenu`.
    - The second row is `NavTabs`.
    - The bar's language switch is hidden; it lives in the account menu.
  - Remove the old name text, the header's Change-password link and the Sign-out button.
- [ ] **Step 6: `language-switch.tsx`.**
  - The bar variant is one segmented control: a bordered rounded container with the two forms side by side. The
    current option is `bg-accent-soft text-accent`; the other is `text-ink-2`.
  - Keep `role="group"`, `aria-label`, `aria-current` and the no-JavaScript forms.
  - The menu variant shows the label (`t.common.language`) and the same segmented control in one row.
- [ ] **Step 7: Dictionaries** (both, same keys):
  - `common.mainMenu`: "Main menu";
  - `common.account`: "Account: {name}";
  - `common.roleAdmin`: "Admin";
  - `common.roleStaff`: "Staff";
  - `feedback.report`: "Report a problem".

  `feedback.reportLabel` stays the accessible name of the report button.
- [ ] **Step 8:** Run `npx vitest run tests/unit`, `npm run lint`, `npm run typecheck` and `npm run build`.
- [ ] **Commit:** `feat(ui): a header with icon tabs that show the current page, a report button and an account menu`.

### Task 2: Tests, guide and documents

**Files:**
- Create: `e2e/support/header.ts`
- Modify:
  - `e2e/session.spec.ts`
  - `e2e/editor.spec.ts`
  - `e2e/keyboard.spec.ts`
  - any other spec or capture step that uses the header's Sign out, Change password or name (grep `e2e/`)
  - `src/app/(app)/guide/content.ts` and the dictionaries (the report step names the button)
  - `docs/design/spec-sheet-editor-design.md` (the header in the screen descriptions)
  - `docs/testing/test-case-status.md`

- [ ] **Step 1: `e2e/support/header.ts`.**
  - `openAccountMenu(page)` clicks the button named `/^(Tài khoản|Account): /` and waits for `role=menu`.
  - `signOutFromMenu(page)` opens the menu and clicks the menu item `/^(Đăng xuất|Sign out)$/`.
  - Replace every direct header Sign-out click with `signOutFromMenu`.
- [ ] **Step 2: `keyboard.spec.ts`.** Add "the account menu is opened, moved through and closed with the keyboard
  alone":
  - Tab to the account button, press Enter: the first menu item is focused.
  - ArrowDown moves to the next item.
  - Escape closes the menu, and the button is focused with `aria-expanded="false"`.
- [ ] **Step 3: `session.spec.ts` TC-53 (360 px).**
  - The header has no horizontal overflow.
  - The tab strip may scroll inside itself, but `document.documentElement.scrollWidth <= clientWidth`.
  - The account button and the report button are visible.
- [ ] **Step 4: Guide.**
  - The report section's first step names the button "Báo lỗi" (vi) / "Report a problem" (en).
  - Grep the guide copy for "Đăng xuất", "Đổi mật khẩu" and "Sign out", and say they are in the account menu.
- [ ] **Step 5: Documents.**
  - In `docs/design/spec-sheet-editor-design.md`, add one paragraph where the header (app shell) is described: the
    tabs, the report button, the language switch and the account menu.
  - In `docs/testing/test-case-status.md`, add the new keyboard case as "written, not yet run".
- [ ] **Step 6:** Run `npm run typecheck`, `npx vitest run tests/unit` and `npm run lint`. Do not run Playwright.
- [ ] **Commit:** `test(ui): the specs sign out through the account menu, and a keyboard test for it`.

## After the tasks (controller)

1. Run the dev server locally and look at the header:
   - at 1440 and 360 px;
   - in light and dark;
   - signed out (the sign-in page has no header) and as Staff and Admin.

   The screenshots come from the guide capture, or from Playwright after the owner allows a run.
2. Push, and send the PR link.
3. Outside working hours:
   ```
   timeout 2700 npx playwright test e2e/session.spec.ts e2e/editor.spec.ts e2e/keyboard.spec.ts e2e/a11y.spec.ts e2e/feedback.spec.ts e2e/ownership.spec.ts
   timeout 1200 npm run guide:shots
   ```
