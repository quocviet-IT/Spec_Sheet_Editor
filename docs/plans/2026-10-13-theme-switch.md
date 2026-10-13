# Theme Switch Implementation Plan

> Work through the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light, Dark and System (the default) can be chosen from the header, remembered in a cookie, and applied by
the server on the first paint. Design: `docs/design/2026-10-13-theme-switch.md`.

**Architecture:**
- The theme helpers live in `src/ui/theme.ts`, a pure module with `THEMES`, `parseTheme`, the cookie name and
  max-age.
- A server action `setTheme` sits in `src/messages/actions.ts` next to `setLocale`, or in a new `src/ui/theme-actions.ts`.
- The root layout renders `data-theme`.
- The CSS keys the existing dark tokens on that attribute.
- A `ThemeMenu` client component mirrors `AccountMenu` and puts a theme row into the account menu for phones.

**Tech Stack:** Next.js 16.3.8, React 19.2, Tailwind 4, `lucide-react` 1.48.0, Vitest 4, Playwright 1.63.

## Global Constraints

- Repo is **public**: never commit `.env.local`, real data, passwords or keys.
  - Stage files one by one by path. Never use `git add -f`, `git add -A` or `git add .`; git-ignored local scratch
    files must never be committed.
- File names, commit messages and documents are in English. The only Vietnamese text is interface copy in
  `src/messages/vi.ts`, plus the language's name on the VI/EN switch. End-to-end tests may match Vietnamese UI text in
  regular expressions.
- Commits carry no attribution trailer of any kind and no tool names.
- Every user-facing string goes in both dictionaries, with the same keys and placeholders.
- From 360 px wide: no horizontal page scroll, and every control is at least 24 × 24 px. Contrast must be at least
  4.5:1 for text and 3:1 for non-text, in light and dark mode. The CSP is unchanged. No database change.
- End-to-end tests run against production. Never start a Playwright run; the controller runs them.
- Run `npx vitest run tests/unit`, `npm run lint`, `npm run typecheck` and `npm run build`.

---

### Task 1: The theme, applied by the server, and the switch

**Files:**
- Create: `src/ui/theme.ts`, `src/ui/theme-menu.tsx`, `tests/unit/theme.test.ts`
- Modify:
  - `src/app/globals.css`
  - `src/app/layout.tsx`
  - `src/ui/app-header.tsx`
  - `src/ui/account-menu.tsx` (the phone row)
  - the server action file
  - the dictionaries

**Interfaces:**
- `export const THEMES = ["light", "dark", "system"] as const; export type Theme = (typeof THEMES)[number];`
- `export const THEME_COOKIE = "theme"; export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;`
- `export function parseTheme(raw: unknown): Theme`, which gives `"system"` for anything unknown.
- `export async function setTheme(form: FormData): Promise<void>` writes the cookie and calls `revalidatePath("/",
  "layout")`.

- [ ] **Step 1: Unit test** `parseTheme`:
  - `"light"`, `"dark"` and `"system"` map to themselves;
  - `"Dark"`, `""`, `undefined` and `42` map to `"system"`.
- [ ] **Step 2: `globals.css`.** Keep `:root` (light). Replace the dark `@media` block with:

```css
:root[data-theme="dark"] {
  /* the existing dark token values, unchanged */
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root[data-theme="system"] {
    /* the same dark token values */
    color-scheme: dark;
  }
}
```

  - Keep both blocks byte-identical apart from their selector, and add a comment saying they must stay in step.
  - A page rendered without the attribute stays light.
- [ ] **Step 3: `layout.tsx`.**
  - Read the cookie with `cookies()` and render `<html lang={locale} data-theme={theme} …>`.
  - Add `suppressHydrationWarning` only if React warns. It should not, because the server and the client render the
    same value.
- [ ] **Step 4: `theme-menu.tsx`.**
  - Copy the structure and keyboard handling of `src/ui/account-menu.tsx`:
    - the panel is always rendered, hidden by the `hidden` class while closed, with the unlayered
      `<noscript><style>` reveal;
    - the `items()` filter on visible boxes;
    - Escape and Tab close it, the arrows, Home and End move, and a click outside closes it.
  - **The button:**
    - 32 px, rounded, `text-ink-2 hover:bg-sunk`, with the icon of the current choice;
    - `aria-label={fill(t.common.themeButton, { choice })}`.
  - **The items:** three forms. Each has a hidden `theme` input and a `button type="submit" role="menuitemradio"
    aria-checked`, its icon and label, and a `Check` icon on the current one.
  - Extract the shared menu-button keyboard logic into a small hook only if it removes real duplication with
    `AccountMenu`, and keep both menus' behaviour identical.
- [ ] **Step 5: The header and the account menu.**
  - `ThemeMenu` sits between `LanguageSwitch` and `AccountMenu`, `max-md:hidden`.
  - In `AccountMenu` the phone-only block, next to the Language row, gains a Theme row: the label and three
    segmented form buttons, each `role="menuitemradio"`, `aria-checked` and `tabIndex={-1}`, posting to `setTheme`.
  - Pass the current theme down from the layout, or read it from a small client context, as `LocaleProvider` does.
- [ ] **Step 6: Dictionaries** (both, same keys), per the design:
  - `common.theme`
  - `common.themeLight`
  - `common.themeDark`
  - `common.themeSystem`
  - `common.themeButton`, which carries the placeholder `{choice}`
- [ ] **Step 7:** Run `npx vitest run tests/unit`, `npm run lint`, `npm run typecheck` and `npm run build`.
- [ ] **Commit:** `feat(ui): choose light, dark or system mode from the header, remembered and applied on first paint`.

### Task 2: Tests, guide and documents

**Files:**
- Create: `e2e/theme.spec.ts`
- Modify:
  - `e2e/keyboard.spec.ts`
  - `src/app/(app)/guide/content.ts` and the dictionaries (one sentence where the language switch is described)
  - `docs/design/spec-sheet-editor-design.md`
  - `docs/testing/test-case-status.md`

- [ ] **Step 1: `e2e/theme.spec.ts`.**
  - **"the theme is chosen, kept after a reload, and System follows the device":**
    1. At 1440 px with `colorScheme: "light"`, open the theme menu and choose Dark.
    2. Expect `html[data-theme="dark"]`, and that `getComputedStyle(document.body).backgroundColor` equals
       `rgb(15, 20, 18)`.
    3. Reload: it is still dark.
    4. Choose System: `data-theme="system"`, and the background is `rgb(245, 247, 245)`.
    5. With `page.emulateMedia({ colorScheme: "dark" })` the background turns dark.
  - Leave the cookie at System at the end: clear it, or choose System.
- [ ] **Step 2: `keyboard.spec.ts`.** Add the theme menu test:
  - Tab to the theme button, press Enter: the first item is focused.
  - ArrowDown moves to the next item.
  - Escape closes the menu, and the button is focused with `aria-expanded="false"`.
- [ ] **Step 3: Guide.** One sentence in both languages where the guide mentions VI/EN: the sun/moon button chooses
  Light, Dark or System, and on a phone it is in the account menu.
- [ ] **Step 4: Documents.**
  - In the design doc, add a line about the theme control where the header is described, plus the new test cases.
  - In the test-status doc, add them as "written, not yet run".
- [ ] **Step 5:** Run `npm run typecheck`, `npx vitest run tests/unit` and `npm run lint`. Do not run Playwright.
- [ ] **Commit:** `test(ui): the theme is chosen, kept and follows the device; a keyboard test for its menu`.
