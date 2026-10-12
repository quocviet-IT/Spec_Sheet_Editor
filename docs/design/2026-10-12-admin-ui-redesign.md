# Admin area redesign

Status: approved by the owner on 2026-10-12, from a mockup of the Users page. This document describes the
design; the implementation plan is `docs/plans/2026-10-12-admin-ui-redesign.md`.

## Goal

The four Admin pages (Users, Access, Audit log, Trash) look and behave like a standard business system.

They gain:
- icons;
- one shared page structure;
- tables with badges;
- a row action menu instead of rows of buttons;
- pagination.

The reserved test accounts are no longer shown at all.

## Scope

- In scope:
  - `src/app/(app)/admin/**`;
  - the shared admin components it needs;
  - the dictionaries;
  - the tests that read these pages;
  - the Admin screenshots of the user guide.
- Out of scope:
  - the sheet list, the editor, sign-in, the guide's own layout;
  - any database change.

  The sheet list may adopt the same components later.

## Visual system

- **Icons**:
  - The package is `lucide-react`, pinned to `1.48.0` (ISC licence). Each icon is an inline SVG component, so the
    Content-Security-Policy needs no change and only the icons used are bundled.
  - Size 16 px in tables and buttons, 18 px in tabs, 20 px beside page titles.
  - Decorative icons are `aria-hidden`. Icon-only buttons have an `aria-label` from the dictionaries.
- **Colours**: only the existing tokens in `src/app/globals.css` (accent, ink, line, surface, sunk, danger,
  warn-soft). New tokens are added only where a badge needs a role colour that has none (success, admin). Each
  new token gets a light and a dark value, and its contrast is checked: text 4.5:1, non-text 3:1.
- **Typography**: unchanged, Be Vietnam Pro.

## Shared components (`src/app/(app)/admin/ui/`)

| Component | Purpose |
|---|---|
| `PageHeader` | Breadcrumb "Admin › Page", a title with an icon, a one-line lead, an optional primary action on the right |
| `AdminTabs` | Replaces `admin-nav.tsx`: tabs with icons, the current one marked, `aria-current="page"` |
| `StatCards` | Two to four counters, each a muted label with an icon and a number |
| `Badge` | A pill with an icon and a label; tones: neutral, accent, success, warning, danger, admin |
| `RowMenu` | A "⋯" button that opens a menu of actions with icons. Destructive actions are red and come last, after a divider |
| `Pagination` | "Showing 1–25 of N", a page-size choice (10, 25, 50), previous and next, the page number |
| `EmptyState` | An icon, a one-line title and a hint, for no rows and for no search match |
| `Dialog` | A modal for forms (Add user, Add domain, Add email). Focus is trapped, Esc closes, focus returns to the opener |
| `RelativeTime` | "2 days ago" with the exact time (Asia/Ho_Chi_Minh) in a `title` and in a `<time dateTime>` attribute |

Accessibility rules:
- `RowMenu` follows the WAI-ARIA menu button pattern:
  - the button has `aria-haspopup="menu"` and `aria-expanded`;
  - Enter, Space or ArrowDown opens the menu on the first item;
  - ArrowUp and ArrowDown move, Home and End jump;
  - Esc closes and returns focus to the button, and a click outside closes.
- Every row's menu button is named after the person or item, for example "Actions for Tạ Quốc Việt", so a screen
  reader and the tests can tell them apart.
- `Dialog` uses `role="dialog"` with `aria-modal`, a labelled title, and the same focus handling as the existing
  dialogs.

## Pages

### Users

- **Header**: the action is "Add user", which opens the existing add-user form in a `Dialog`.
- **Stat cards**: total, active, suspended and Admins, counted over real people only.
- **Toolbar**:
  - a search box with an icon (name or email, 300 ms debounce, as today);
  - a role filter: all, Admin, Staff;
  - a status filter: all, active, suspended, waiting for a first password.
- **Table columns**:
  - User: an avatar with initials, the name, "(you)", and the email with a sign-in icon (a key for a password account, a globe for a Google
    account, since lucide ships no brand marks; the method is also in the icon's label);
  - Role: a badge;
  - Status: a badge. "Waiting for a first password" replaces the separate yellow tag;
  - Last active: `RelativeTime`, or "Never signed in";
  - Sheets: right-aligned;
  - Actions: a `RowMenu` with:
    - Make Admin or Make Staff;
    - Issue new password, for password accounts;
    - a divider;
    - Suspend (danger) or Reinstate.
  - The person's own row keeps today's rules: they cannot suspend themselves, and the last Admin cannot be
    demoted. A refused action shows the existing message.
- **The confirm dialog** for role and status changes stays as it is, opened from the menu.
- **Pagination** happens in the browser over the fetched list, which is already read in full and paged with
  `range()`: 25 rows per page by default. Search and filters apply before pagination, and changing them returns
  to page 1.
- **Test accounts**: `splitTestAccounts` stays. The test part is not rendered unless the URL has `?show=test`;
  the page still checks the Admin role. The automated tests use that parameter. Nothing on the page hints at it.

### Access

- **Header**: no primary action. The two lists each have their own Add button in a card header.
- **Two cards**, "Permitted domains" (globe icon) and "Permitted emails" (mail icon). Each is a table:
  - entry;
  - note;
  - Google accounts admitted (a badge);
  - added (`RelativeTime`);
  - a `RowMenu` with Remove (danger).

  Adding opens a `Dialog` with the existing validation and messages. Removing keeps the existing "{n} accounts
  will lose access" confirmation.
- **Settings card** (sliders icon): the four settings as rows. Each row has an icon, the label, the allowed range
  as a hint, the value input and the unit, and one Save button for the card, as today.

### Audit log

- **Toolbar**: the existing filters (time range, person, action group, sheet id) on one wrapping line, with icons,
  plus "Download CSV" (download icon) on the right.
- **Table**:
  - time (`RelativeTime` plus the exact time);
  - person (avatar and name);
  - action: an icon per action group (upload, save, export, trash, restore, purge, sign-in, user change, access
    change, settings, maintenance) and the readable label;
  - target;
  - details, expandable as today.
- **Pagination on the server**:
  - `?page=` and `?size=` replace the keyset "Load more" link;
  - the first page pins `?upto=<newest id>`, so the pages do not shift while new entries arrive, the same snapshot
    idea as the CSV;
  - the total comes from the existing `countAudit` with that bound;
  - offsets are `range(from, to)` over `id <= upto`, in descending order.

### Trash

- **Table**:
  - a thumbnail (the existing signed thumbnail);
  - the sheet name;
  - deleted by (avatar and name);
  - deleted (`RelativeTime`);
  - a `RowMenu` with:
    - Restore;
    - a divider;
    - Delete permanently (danger), which opens the existing typed-name `PurgeDialog`.
- **Pagination on the server** with `?page=` and `?size=`, so only one page of thumbnails is signed.
- **Orphan clean-up**: a card with an icon, below the table, with the same behaviour.

## Copy

- Every new string goes in `src/messages/vi.ts` and `src/messages/en.ts`, with the same keys and placeholders.
  The existing unit test enforces this.
- Labels are short and in sentence case.
- The Table B.1 messages stay word for word.

## Testing

- **Unit tests**:
  - the page arithmetic: page count, clamping an out-of-range page, "Showing a–b of n";
  - the relative-time formatter: just now, minutes, hours, days, older than 30 days giving a date, in both
    languages;
  - the users filter and search: role, status, search, and their combination;
  - the audit offset query builder with `upto`.
- **End-to-end tests**: the specs that use the Admin pages are rewritten for the new structure:
  - `admin.spec.ts`: `changeUser` opens the row menu by its accessible name and uses `?show=test`;
  - `a11y.spec.ts`: axe in both themes on every Admin page, with a menu open and a dialog open;
  - `keyboard.spec.ts`: open the row menu with the keyboard, move, Esc returns focus;
  - `csp.spec.ts`.
  The guide's Admin screenshots are captured again (`npm run guide:shots`) and looked at.
- **Where the end-to-end tests run** (owner's decision, 2026-10-12): on the current project, which is production,
  not on a separate test project. They touch only the three reserved test accounts and their own sheets; the
  Admin spec briefly changes the shared settings and the access lists and restores them, and it writes audit
  entries. So only the specs that cover the Admin pages are run (`admin`, `a11y`, `keyboard`, `csp`, and the
  guide capture), never the full suite, and the owner is told before each run so it happens when no one is
  working. `E2E_DEV_PROJECT_REF` in `.env.local` is switched back on only for those runs.

## Risks and decisions

- Moving actions into menus changes every Admin end-to-end selector. They are rewritten in the same change.
- Client-side pagination of users is right while the company has fewer than about a thousand accounts. The fetch
  already pages through all of them.
- Offset paging in the audit log is pinned with `upto`, so a page never repeats or skips an entry while people
  work.
