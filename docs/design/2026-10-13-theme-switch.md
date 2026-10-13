# Light and dark mode switch

Status: approved by the owner on 2026-10-13. The implementation plan is `docs/plans/2026-10-13-theme-switch.md`.

## Goal

The app already has a light and a dark palette (`src/app/globals.css`). It follows only the operating system
(`prefers-color-scheme`). Each person can now choose **Light**, **Dark** or **System** (the default, which keeps
today's behaviour). The choice is remembered on their machine.

## Behaviour

- **The choice:**
  - It is stored in the cookie `theme` (`light` | `dark` | `system`), for one year, `path=/` and `SameSite=Lax`.
  - It is written by a server action `setTheme`, the same way `setLocale` writes the language.
- **Rendering:**
  - The root layout reads the cookie and renders `<html data-theme="light|dark|system">`, so the first paint is
    already right: no flash and no change after hydration.
  - Nothing switches the theme in client code.
- **The CSS:**
  - The light tokens stay on `:root`.
  - The dark tokens apply to `:root[data-theme="dark"]`, and to `:root[data-theme="system"]` inside
    `@media (prefers-color-scheme: dark)`.
  - `color-scheme` follows the same three cases, so native controls match.
  - The dark token values are unchanged.
  - The sheet in the editor stays paper-white in both themes, as today.
- **The control on desktop:**
  - An icon button in the header between the language switch and the account button.
  - It shows the current choice: lucide `Sun` for Light, `Moon` for Dark, `Monitor` for System.
  - It has the accessible name "Theme: {choice}", `aria-haspopup="menu"` and `aria-expanded`.
  - It opens a small menu of three `menuitemradio` items, each with its icon. A check mark and `aria-checked`
    mark the current one.
  - Each item is a real form posting to `setTheme`, so it works without JavaScript. The panel is always in the page
    and revealed by a `<noscript>` rule, as the account menu does.
  - Keyboard behaviour is the same as the account menu.
- **On a phone (below 768 px):** the header button is hidden, and the account menu gains a row "Theme: Light | Dark
  | System" (a segmented control of three forms) beside the Language row.
- **Copy** (English; the Vietnamese lives in `src/messages/vi.ts`):
  - `common.theme`: "Theme"
  - `common.themeLight`: "Light"
  - `common.themeDark`: "Dark"
  - `common.themeSystem`: "System"
  - `common.themeButton`: "Theme: {choice}"

## Testing

- **Unit:** `parseTheme` maps `light`, `dark` and `system` to themselves, and anything else to `system`.
- **End-to-end:**
  - Choose Dark: `html[data-theme=dark]`, and the body background computes to the dark paper colour.
  - Reload: it is still dark.
  - Choose System with an emulated light scheme: the light paper colour.
  - The keyboard test for the theme menu: open with Enter, move with the arrows, close with Escape and get focus
    back.
- **The existing a11y contrast scan** uses an emulated scheme with the default `system` theme, and keeps working.
- **Visual check** at 1440 and 360 px, in each of the three choices.
