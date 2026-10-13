# Header redesign

Status: approved by the owner on 2026-10-13, option A of three mockups. The implementation plan is
`docs/plans/2026-10-13-header-redesign.md`.

## Problems with the current header

- Two items read "Feedback" side by side: the menu link to the Feedback page, and the button that opens the report
  dialog.
- The menu is plain text, with no icons and no sign of the current page.
- The account is spread over three items: the name (which looks like a link), "Change password" and "Sign out".
- On a phone the bar wraps untidily.

## The design (option A)

- **Desktop, from left to right:**
  - **Brand:** the logo and "Spec Sheet Editor", a link to `/sheets`.
  - **Menu tabs**, each with a lucide icon:
    - Sheets (`FileText`)
    - Guide (`BookOpen`)
    - Feedback (`MessagesSquare`), with the existing red unread count
    - Admin (`ShieldCheck`, Admins only)

    The current tab has `bg-accent-soft text-accent` and `aria-current="page"`. Sheets is current on every
    `/sheets…` page, the editor included; Admin is current on every `/admin…` page; Guide on `/guide…`; Feedback
    on `/feedback…`.
  - A spacer.
  - **The report button:** `MessageSquareWarning` with the visible label **"Report a problem"** (vi "Báo lỗi"). It
    opens the existing dialog. Its accessible name stays "Report a problem or suggest an improvement".
  - **The language switch**, restyled as one segmented control `VI | EN` (still two forms posting to `setLocale`, so
    it works without JavaScript).
  - **The account button:** a round avatar with the user's initials and a chevron. Its accessible name is
    "Account: {name}".
- **The account menu** (`role="menu"`, opened by the account button):
  - A header with the full name, the email and a role badge: "Admin", or "Staff" (vi "Nhân viên").
  - **Change password** (`KeyRound`), only for password accounts: a link to `/account/password`.
  - A divider.
  - **Sign out** (`LogOut`, danger colour): a form posting to `signOut`.
  - **Keyboard:**
    - Enter, Space or ArrowDown opens the menu and focuses the first item; ArrowUp opens it on the last item.
    - Arrows move between the items, and Home and End jump to the ends.
    - Escape closes the menu and returns focus to the button. Tab closes it as well.
    - A click outside closes it.
  - The behaviour mirrors the Admin row menu (`src/admin/row-menu-keys.ts`).
- **Phone (below 768 px):**
  - First row: the brand (logo and name), the report button with its icon only, and the account button.
  - Second row: the menu tabs in a horizontally scrollable strip (`overflow-x-auto`). The page itself never scrolls
    sideways.
  - The language switch moves into the account menu, above Change password.
- **Unchanged:**
  - the header's width (`max-w-6xl`);
  - the colours, which come from the existing tokens and work in both themes;
  - the CSP, the unread-count data, and the dialog.

## Testing

- **Unit:** `activeTab(pathname)` returns `sheets | guide | feedback | admin | null` for each rule above,
  including `/sheets/<id>`, `/admin/audit` and `/account/password` (none).
- **End-to-end:** the specs that sign out (`editor.spec.ts`, `session.spec.ts`) and any that use the header's
  password link open the account menu first, through a shared helper.
- **Keyboard spec:** add the account menu (open with Enter, arrows, Escape returns focus).
- **At 360 px:** no horizontal scroll, and every control is at least 24 × 24 px.
- **Guide:**
  - The step that names the header button says "Báo lỗi" / "Report a problem".
  - The guide screenshots are captured again on the next end-to-end run.
