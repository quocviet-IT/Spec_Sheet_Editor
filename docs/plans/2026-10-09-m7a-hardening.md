# M7a Hardening Implementation Plan

> Work through the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app is ready for release apart from the steps only the owner can take. It gets a strict
Content Security Policy, a production-build test mode with the NFR-01 timings and a check that the secret
key never reaches the browser bundle (TC-77). The open items carried from M4–M6 are closed, and the design
test cases that have no automated test get one. There is an in-app user guide in Vietnamese and English
with screenshots, a WCAG 2.2 AA and dark-mode pass with a keyboard-only journey, and a status table for
all 77 test cases.

**Architecture:** No migration and no new runtime dependency.
- The CSP is built by a pure function and applied in `src/proxy.ts`, with a fresh nonce per request.
  Next.js reads the nonce from the request's `Content-Security-Policy` header and puts it on its own
  scripts.
- A second Playwright config runs the same suite against `next build && next start`.
- `postbuild` scans `.next/static` for the secret key's name, prefix and value.
- The guide is a server page whose text lives in the two dictionaries. A Playwright capture script makes
  its screenshots from synthetic sheets, together with the callout positions.
- Accessibility is checked with axe-core in Playwright, on every screen, in both themes.

**Tech Stack:** Next.js 16.3.8 (proxy, server components), React 19.2, Tailwind CSS 4, Vitest 4,
Playwright 1.63, `@axe-core/playwright` 4.13.0 (new dev dependency, exact version).

**Spec:** `docs/design/spec-sheet-editor-design.md`, covering:
- NFR-01 (the timings), NFR-02, NFR-03, NFR-06 (360 px list; 1024 px editor and Admin area), NFR-07
  (WCAG 2.2 AA, keyboard, error messages that state the cause and the fix), NFR-10.
- Test cases TC-06, TC-07, TC-51, TC-53, TC-60, TC-75, TC-77.
- Roadmap M7 and the three "Carried into …" sections of `docs/plans/2026-10-07-spec-sheet-editor-roadmap.md`.

**Out of scope (M7b, needs the owner):** merging into `main`, the Vercel production project and its
environment variables, the production Supabase project, the first production Admin (TC-54), the
production sign-in check, TC-47 on macOS, and switching Google sign-in on (TC-01, TC-02, TC-64).

## Global Constraints

- Repo is **public**: never commit `.env.local`, real sheets, SO/MO numbers, passwords or keys.
  - Stage files one by one (`git add <path>`), never `git add -A` or `git add .`.
  - Before every commit, grep the staged diff for `SO2`, `MO2`, `sb_secret_` and `service_role`.
- File names, commit messages and documents are in English. The only Vietnamese text in the repository
  is interface copy in `src/messages/vi.ts`, plus the language's own name ("Tiếng Việt") on the VI/EN
  switch. End-to-end tests may match Vietnamese interface text in regular expressions.
- Commits carry no attribution trailer of any kind: no Co-Authored-By lines and no tool names.
- Every user-facing string comes from `src/messages/vi.ts` + `src/messages/en.ts`; both keep exactly the
  same keys.
- Invisible characters (byte order mark, bidirectional marks, C1 controls) are written as `\u` escapes in
  source, never as raw characters.
- No migration in M7a; applied migrations are never edited.
- NFR-10: the secret-key client (`createSupabaseAdmin`) gains no new use.
- Unit tests: `npx vitest run tests/unit`.
- SQL tests (`tests/sql/`) need the Postgres pooler port, which this network blocks. Write them, run the
  type check, and report them as "not run on this network".
- End-to-end tests:
  - Always have timeouts.
  - Run against the development project only (`E2E_DEV_PROJECT_REF` guard, HTTPS only).
  - Use only the reserved accounts `e2e-staff@ctyhp.vn`, `e2e-staff-b@ctyhp.vn` and `e2e-admin@ctyhp.vn`.
  - Restore every setting, role, status and access entry they change, and clean up what they create.
  - Never touch `admin@ctyhp.vn`.
  - Run a spec with `npx playwright test e2e/<name>.spec.ts`; a run that may take minutes is wrapped in
    `timeout <seconds>`.
- Before calling a UI change done, take screenshots in both languages and both themes (light and dark)
  and look at them.
- Times are shown in `Asia/Ho_Chi_Minh`.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/security/csp.ts` | Builds the CSP string and the nonce (pure) |
| `src/proxy.ts` | Applies the CSP to every page request and response |
| `e2e/csp.spec.ts` | No CSP violation across the main screens |
| `playwright.prod.config.ts` | The same suite against a production build |
| `e2e/perf.spec.ts` | NFR-01 timings, enforced on the production build |
| `scripts/bundle-scan.ts`, `scripts/check-bundle.mts` | TC-77: the secret key is not in `.next/static` |
| `src/sheets/save-result.ts` | The `save_sheet` row to a save result (pure) |
| `e2e/session.spec.ts` | TC-06, TC-07, TC-53 |
| `e2e/storage.spec.ts` | TC-51 |
| `src/app/(app)/guide/*` | The user guide page |
| `e2e/guide/shots.capture.ts`, `playwright.guide.config.ts` | Guide screenshots and callout positions |
| `public/guide/{vi,en}/` | The screenshots (`*.jpg`) and `points.json` |
| `e2e/a11y.spec.ts`, `e2e/keyboard.spec.ts` | WCAG 2.2 AA scans in both themes, keyboard-only journey |
| `docs/testing/test-case-status.md` | Status of TC-01 – TC-77 and NFR-01 – NFR-10 |

---

### Task 1: Content Security Policy with a per-request nonce

**Files:**
- Create: `src/lib/security/csp.ts`, `tests/unit/csp.test.ts`, `e2e/csp.spec.ts`
- Modify: `src/proxy.ts`, `next.config.ts` (comment only), `src/lib/page/render.ts`
  (`isEvalSupported: false`)

**Interfaces:**
- Produces: `buildCsp(options: { nonce: string; supabaseUrl: string; dev: boolean }): string` and
  `newNonce(): string`.

**Requirements:**
- Pages get this policy, enforced and not report-only, from `src/proxy.ts`. Static files keep the
  `frame-ancestors 'none'` header from `next.config.ts`. `<supabase>` is the origin of
  `NEXT_PUBLIC_SUPABASE_URL`.

  | Directive | Value |
  |---|---|
  | `default-src` | `'self'` |
  | `script-src` | `'self' 'nonce-<n>' 'strict-dynamic'`; in development also `'unsafe-eval'` (React and Next.js need it there) |
  | `style-src` | `'self' 'unsafe-inline'` (server-rendered `style` attributes and the Next.js font styles) |
  | `img-src` | `'self' blob: data: <supabase>` (thumbnails are signed Storage URLs) |
  | `font-src` | `'self'` |
  | `connect-src` | `'self' <supabase>`; in development also `ws:` (hot reload) |
  | `worker-src` | `'self' blob:` |
  | `object-src` | `'none'` |
  | `base-uri` | `'self'` |
  | `form-action` | `'self' <supabase> https://accounts.google.com` (form-action also applies to redirects after a post; the Google sign-in post redirects through Supabase to Google) |
  | `frame-ancestors` | `'none'` |

- Add `'wasm-unsafe-eval'` to `script-src` only if the CSP spec shows the main page needs it. The OCR
  models and the pdf.js decoders run in Workers, which get their own policy from their own (static)
  response.
- In `src/proxy.ts`, every path sets the policy on the forwarded request headers (Next.js takes the
  nonce from there) and on the response:
  - the early return when there is no `sb-` cookie;
  - the normal return;
  - the response rebuilt inside `setAll`.
  Use one helper so no path can miss it.
- `newNonce()` returns 16 random bytes in base64 (`crypto.getRandomValues`, then `btoa`).
- `src/lib/page/render.ts`: pass `isEvalSupported: false` to `pdfjs.getDocument`. Otherwise pdf.js
  probes `new Function` and the policy reports a violation.
- `npm run build` must list no page as static (`○`). A static page would carry scripts without the nonce,
  and they would be blocked. If one is static, make it dynamic and say why in a comment.

- [ ] **Step 1: Write the failing unit test** `tests/unit/csp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "@/lib/security/csp";

const directives = (csp: string) =>
  Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

describe("buildCsp", () => {
  const prod = directives(buildCsp({ nonce: "abc", supabaseUrl: "https://ref.supabase.co/", dev: false }));
  const dev = directives(buildCsp({ nonce: "abc", supabaseUrl: "https://ref.supabase.co", dev: true }));

  it("allows scripts only by nonce in production", () => {
    expect(prod["script-src"]).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(prod["script-src"]).not.toContain("'unsafe-inline'");
    expect(prod["script-src"]).not.toContain("'unsafe-eval'");
  });
  it("adds eval and the hot-reload socket only in development", () => {
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toContain("ws:");
    expect(prod["connect-src"]).not.toContain("ws:");
  });
  it("names the Supabase origin, not the full URL", () => {
    expect(prod["connect-src"]).toEqual(["'self'", "https://ref.supabase.co"]);
    expect(prod["img-src"]).toContain("https://ref.supabase.co");
  });
  it("blocks framing, plugins and base changes", () => {
    expect(prod["frame-ancestors"]).toEqual(["'none'"]);
    expect(prod["object-src"]).toEqual(["'none'"]);
    expect(prod["base-uri"]).toEqual(["'self'"]);
    expect(prod["worker-src"]).toEqual(["'self'", "blob:"]);
  });
});

describe("newNonce", () => {
  it("is base64 of 16 bytes and differs each time", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/csp.test.ts`. Expected: FAIL, because the module does not exist.
- [ ] **Step 3: Implement** `src/lib/security/csp.ts`:

```ts
/**
 * The page Content-Security-Policy. Scripts run only with the per-request nonce (Next.js puts it on its
 * own scripts) or when loaded by such a script ('strict-dynamic'). Pure: used by the proxy and by tests.
 */
export function buildCsp({ nonce, supabaseUrl, dev }: { nonce: string; supabaseUrl: string; dev: boolean }): string {
  const supabase = new URL(supabaseUrl).origin;
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "blob:", "data:", supabase]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", supabase, ...(dev ? ["ws:"] : [])]],
    ["worker-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'", supabase, "https://accounts.google.com"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** 16 random bytes in base64: a fresh nonce for every page request. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
```

- [ ] **Step 4:** Run the unit test. Expected: PASS.
- [ ] **Step 5: Apply the policy in `src/proxy.ts`.**
  - Compute `nonce` and `csp` once per request.
  - Have `forwardHeaders` also set `Content-Security-Policy` on the forwarded request headers.
  - Add `function withCsp(response: NextResponse, csp: string): NextResponse` that sets the response
    header, and call it on all three paths.
  - `dev` is `process.env.NODE_ENV === "development"`.
- [ ] **Step 6:** In `src/lib/page/render.ts`, add `isEvalSupported: false` to the `getDocument` options.
  In `next.config.ts`, replace the comment "A nonce-based script CSP is added in M7 hardening." with
  "Pages also get the full policy from src/proxy.ts (src/lib/security/csp.ts)."
- [ ] **Step 7: Write `e2e/csp.spec.ts`.**
  - Each test registers
    `page.addInitScript({ content: "window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI))" })`
    (a string, so the test transpiler adds nothing). It also collects console errors that contain
    "Content Security Policy".
  - At the end of each test, assert both lists are empty and print them in the failure message.
  - Tests:
    1. The `/login` response header has `script-src`, a `'nonce-` value and `frame-ancestors 'none'`.
       Two loads give two different nonces. Use a fresh context with no storage state.
    2. As Staff: upload a sheet with `uploadSheet`, then open `/sheets` and wait for the thumbnail image
       to load (`naturalWidth > 0`).
    3. As Staff: an image sheet goes through OCR detection until the version is 2 (`waitForVersion`).
       This runs the OCR Worker, the runtime from a Blob URL and its thread Workers. Then export PNG and
       PDF with `exportSheet`.
    4. As Admin (`test.use({ storageState: "e2e/.auth/admin.json" })`): visit `/admin/users`,
       `/admin/access`, `/admin/audit` and `/admin/trash`.
  - Reuse the helpers in `e2e/support/sheets.ts` and `e2e/support/files.ts`.
  - After each test, delete the sheets the test made: follow the `afterEach` pattern in
    `e2e/upload.spec.ts`.
- [ ] **Step 8:** Run `timeout 900 npx playwright test e2e/csp.spec.ts`. Expected: 4 passed.
  Then run `timeout 600 npx playwright test e2e/detect.spec.ts e2e/export.spec.ts`. Expected: all
  passed (OCR and export still work under the policy).
- [ ] **Step 9:** Run `npm run build`. Expected: it succeeds, and the route table lists no `○ (Static)`
  page apart from the 404 that Next.js generates. If that 404 is static, check that a missing page still
  loads with no violation: open `/no-such-page` in the CSP spec.
- [ ] **Step 10: Commit** with the message
  `feat(security): content security policy with a per-request script nonce`.

### Task 2: Production-build test mode, NFR-01 timings, and the bundle secret scan (TC-77)

**Files:**
- Create: `playwright.prod.config.ts`, `e2e/perf.spec.ts`, `scripts/bundle-scan.ts`,
  `scripts/check-bundle.mts`, `tests/unit/bundle-scan.test.ts`
- Modify: `package.json` (scripts `e2e:prod`, `postbuild`), `vitest.config.*` (only if `tests/unit`
  cannot import from `scripts/`)

**Interfaces:**
- Produces:
  - `findLeaks(files: { path: string; text: string }[], needles: { label: string; value: string }[]): { label: string; path: string }[]`
    in `scripts/bundle-scan.ts`.
  - `playwright.prod.config.ts`, exporting the base config with `metadata: { production: true }`.

**Requirements:**
- `playwright.prod.config.ts` imports the default config from `./playwright.config` and overrides:
  - `webServer: { command: "npm run build && npm run start", url: "http://localhost:3000/login", reuseExistingServer: false, timeout: 600_000 }`
  - `metadata: { production: true }`
  - Same port 3000. A running dev server makes Playwright stop with "port in use", which is what we want:
    the production run must not silently test the dev server.
- `package.json`: `"e2e:prod": "playwright test -c playwright.prod.config.ts"`.
- `e2e/perf.spec.ts` (NFR-01): skip unless `test.info().config.metadata.production === true`.
  1. A text-layer PDF sheet, opened once so its detections are stored (version 2). Then three reopens:
     each measured from just before `page.goto` until all 11 markers are visible. Each must be ≤ 3,000 ms.
  2. Read on click on a value missing from the text layer, once the reader is ready, ≤ 5,000 ms. Use the
     same setup as TC-24 in `e2e/tools.spec.ts`: move its setup into a helper in `e2e/support/sheets.ts`
     instead of copying it.
  3. PDF export of an edited sheet ≤ 5,000 ms, using `pressExport`'s `ms`.
  - Print each measurement once as `console.log("[timing] <name> <ms> ms")`; the result goes into the
    roadmap.
- `scripts/bundle-scan.ts` exports `findLeaks`, which is pure: for each file and each needle with a
  non-empty value, report `{ label, path }` when `text.includes(value)`.
- `scripts/check-bundle.mts`:
  - Walks `.next/static` recursively and reads every `.js`, `.css`, `.json`, `.html`, `.txt` and `.map`
    file.
  - Loads `.env.local` if present (`dotenv`, `quiet: true`) and builds these needles:
    - `{ label: "the name SUPABASE_SECRET_KEY", value: "SUPABASE_SECRET_KEY" }`
    - `{ label: "the sb_secret_ key prefix", value: "sb_secret_" }`
    - `{ label: "the secret key value", value: process.env.SUPABASE_SECRET_KEY ?? "" }`
  - Prints `Bundle check: <n> files, no secret found` and exits 0. Otherwise it prints each label and
    file path — never the value — and exits 1. With no `.next/static` it prints that and exits 1.
- `package.json`: `"postbuild": "tsx scripts/check-bundle.mts"`. A leak then fails the build, on Vercel
  too, because there the variable is set at build time.

- [ ] **Step 1: Write the failing unit test** `tests/unit/bundle-scan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findLeaks } from "../../scripts/bundle-scan";

describe("findLeaks (TC-77)", () => {
  const needles = [
    { label: "the name SUPABASE_SECRET_KEY", value: "SUPABASE_SECRET_KEY" },
    { label: "the secret key value", value: "sb_secret_example123" },
    { label: "an unset value", value: "" },
  ];
  it("reports each needle found, by label and path", () => {
    const files = [
      { path: "a.js", text: "const k = process.env.SUPABASE_SECRET_KEY" },
      { path: "b.js", text: "x='sb_secret_example123'" },
      { path: "c.js", text: "nothing here" },
    ];
    expect(findLeaks(files, needles)).toEqual([
      { label: "the name SUPABASE_SECRET_KEY", path: "a.js" },
      { label: "the secret key value", path: "b.js" },
    ]);
  });
  it("ignores empty needles, so an unset variable never matches every file", () => {
    expect(findLeaks([{ path: "a.js", text: "" }], needles)).toEqual([]);
  });
});
```

- [ ] **Step 2:** Run it. Expected: FAIL. **Step 3:** Implement `scripts/bundle-scan.ts`. **Step 4:**
  Run it. Expected: PASS.
- [ ] **Step 5:** Write `scripts/check-bundle.mts` and add `postbuild`. Run `npm run build`. Expected:
  the build succeeds and the last line is `Bundle check: … no secret found`. Prove the check works with a
  throwaway file, `node -e "require('fs').writeFileSync('.next/static/leak-probe.js','SUPABASE_SECRET_KEY')"`:
  `npx tsx scripts/check-bundle.mts` must exit 1 and name `leak-probe.js`. Delete the probe and run it
  again. Expected: exit 0.
- [ ] **Step 6:** Write `playwright.prod.config.ts`, the `e2e:prod` script and `e2e/perf.spec.ts`.
  - With the dev server running, `npx playwright test e2e/perf.spec.ts` shows 3 skipped.
  - Stop the dev server, then run `timeout 1500 npm run e2e:prod -- e2e/perf.spec.ts`. Expected: 3
    passed, with the three `[timing]` lines. Paste them into the report.
- [ ] **Step 7: Commit** with the message
  `feat(release): production-build test mode with the NFR-01 timings, and a build check that the secret key is not in the bundle`.

### Task 3: Editor screen robustness (carried from M4 and M5)

**Files:**
- Modify:
  - `src/app/(app)/sheets/[id]/editor.tsx`
  - `src/app/(app)/sheets/[id]/use-leave-guard.ts`
  - `src/app/(app)/sheets/[id]/edit-popover.tsx`
  - `src/app/(app)/sheets/[id]/value-list.tsx`
  - `src/sheets/actions.ts`, `src/sheets/queries.ts`
  - `src/lib/ocr/engine.ts`
  - the dictionaries, only if a new message is needed
- Create: `src/sheets/save-result.ts`, `tests/unit/save-result.test.ts`
- Test: `e2e/editor.spec.ts`, `e2e/tools.spec.ts`, `e2e/detect.spec.ts`, `e2e/export.spec.ts`

**Requirements** (each one is a separate finding, located by an audit of the current code):

1. **The load runs once per sheet** (`editor.tsx:291-312`).
   - Today the effect that fetches and renders the source page lists `sheet.sourceUrl`, which is a new
     signed URL on every server render. It also lists `sourceType`, `pageW` and `pageH`. Any refresh
     re-fetches the page and replaces the loaded state.
   - Make the effect depend on `sheet.id` only, and read the other values from a ref.
   - Test (e2e): open a sheet and edit a value. Switch the language with the VI/EN switch (a server-action
     post that re-renders the page), then save. The edit is still on screen and saved, and the source file
     was requested once: count requests to `/storage/v1/object/sign/` whose path ends in `source.`.
2. **Leave guard: Back/Forward and posts that leave** (`use-leave-guard.ts`).
   - While there are unsaved changes, a Back or Forward traversal asks first. Use the Navigation API:
     - `navigation.addEventListener("navigate", …)`;
     - when `event.navigationType === "traverse"` and `event.cancelable`, call `event.preventDefault()`
       and ask with the same message as the link guard;
     - if the person chooses to leave, set a one-shot bypass and call
       `navigation.traverseTo(event.destination.key)`.
   - The app supports current Chrome and Edge only (NFR-06), which have this API. Guard the code with
     `"navigation" in window`, so other browsers keep today's behaviour.
   - The header's Sign out form also asks first while there are unsaved changes: a capture-phase `submit`
     listener on `document` for forms outside the editor, except the language switch.
   - After item 1, the language switch keeps the edits, so it needs no question. The e2e test in item 1
     proves that.
   - Tests (e2e): an edit, then `page.goBack()`, shows the question; choosing to stay keeps the edit.
     Sign out with an edit shows the question.
   - Today TC-39 calls `page.on("dialog")` for the `confirm`. If the guard uses `window.confirm`, follow
     the same pattern.
3. **Focus returns to what opened the popover** (`editor.tsx:142-144`, `:371-374`). When the popover was
   opened from a value-list row, closing it (Esc, apply, cancel) focuses that row, not the marker.
   - Test (e2e): open from the list with Enter, press Esc, and check the focused element is the row.
4. **The same notice twice is announced twice** (`editor.tsx:645-649`). Give each notice an increasing
   id and use it as the `key` of the `role="alert"` element.
   - Test (e2e): trigger the same refusal twice (TC-34's box into the table, twice), and see that the
     alert element was replaced. Check this with a `data-notice-id` attribute that changes.
5. **A click outside an open popover only closes it** (`edit-popover.tsx:60-66`, `editor.tsx:493`).
   - Today one click both closes the popover and starts a read on click. Decided: the click only closes
     the popover; a second click reads.
   - Test (e2e): with a popover open, click an unmarked value. The popover closes, no new popover opens
     and no read starts (no new detection row).
6. **A refused save is not reported as a conflict** (`src/sheets/actions.ts:114-123`).
   - Move the mapping from the `save_sheet` row to the result into a pure
     `saveResult(row, sentVersion)` in `src/sheets/save-result.ts`:
     - `saved=true` gives `{ ok, version }`;
     - `saved=false` and deleted gives `trashed`;
     - `saved=false` with a stored version greater than the sent one gives `conflict`, with who saved and
       when;
     - `saved=false` with the same version, which only an RLS refusal can produce, gives
       `{ error: "unknown" }`.
   - Unit-test every branch in `tests/unit/save-result.test.ts`.
7. **Data that fails the schema reads the same in both paths.**
   - Today the page shows `dataBroken` (`src/sheets/queries.ts:97-117`), while `loadEditorState`
     (`src/sheets/actions.ts:141-142`), used by "Load latest" in the conflict dialog, returns
     `{ error: "unknown" }`.
   - Make `loadEditorState` return `{ error: "broken" }` and show the same `dataBroken` message there.
     Nobody may overwrite data the app cannot read.
   - Add the case to the unit tests of whatever pure function you extract.
8. **A failed `.wasm` download reads as a download failure** (`src/lib/ocr/engine.ts:41-79`).
   - Fetch the `.wasm` beside the `.mjs` in `runtimePaths`, with the same `runtime_download` error.
   - Give the bytes to onnxruntime as `ort.env.wasm.wasmBinary` (supported by onnxruntime-web 1.30),
     instead of letting `InferenceSession.create` fetch them.
   - Test (e2e, in `detect.spec.ts` beside TC-25): block `**/ort-wasm-simd-threaded.wasm`. The editor
     shows the download message, not the "browser cannot run the reader" one.
9. **Test: "Apply there too" in the export check skips values already edited.** Add the e2e case to
   `e2e/export.spec.ts`:
   - three equal old values, one edited to something else first;
   - "Apply there too" changes only the one left unedited.
10. **Test: Shift+Tab from the export dialog's first control goes to its last.** Add the e2e case
    (`export-dialog.tsx:69-76`).

- [ ] **Step 1:** Write the unit test for `saveResult` and run it. Expected: FAIL. Implement it and wire
  it into `saveSheet`. Expected: PASS.
- [ ] **Step 2:** Make items 1–5, 7 and 8 one at a time. For each, write the e2e test first and see it
  fail on the old code where that is possible, then make the change.
- [ ] **Step 3:** Add the tests for items 9 and 10.
- [ ] **Step 4:** Run `npx vitest run tests/unit`, `npm run lint`, `npm run typecheck`, then
  `timeout 1800 npx playwright test e2e/editor.spec.ts e2e/tools.spec.ts e2e/detect.spec.ts e2e/export.spec.ts`.
  Expected: all passed.
- [ ] **Step 5:** Take screenshots of the editor with a notice and with the leave question, in both
  languages and both themes, and look at them.
- [ ] **Step 6: Commit** in focused commits, for example:
  - `fix(editor): load the page once per sheet, so a refresh keeps the edits`
  - `fix(editor): ask before Back, Forward or Sign out with unsaved changes`
  - `fix(editor): focus, notices and outside clicks behave predictably`
  - `fix(sheets): a refused save is an error, not a conflict; unreadable data reads the same everywhere`
  - `fix(ocr): a failed runtime download says so`

### Task 4: Pure-module fixes and the unit-test gaps

**Files:**
- Modify: `src/editor/pixels.ts`, `src/editor/geometry.ts` (doc comments), `src/editor/pdf-text.ts`,
  `e2e/support/sheets.ts` (`dragBox`), `e2e/tools.spec.ts` (TC-35), `e2e/export.spec.ts` (the
  `waitForTimeout` near line 106)
- Test: `tests/unit/editor-pixels.test.ts`, `tests/unit/editor-geometry.test.ts`,
  `tests/unit/pdf-text.test.ts`, `tests/unit/editor-detections.test.ts`,
  `tests/unit/editor-schema.test.ts`

**Requirements:**
1. `analyseBox` (`pixels.ts:98-109`): when the two biggest runs differ by less than 2× in dark-pixel
   count, choose the run whose centre is nearer the box centre.
   - Unit test: a box with a strong run at the edge and a slightly weaker run in the middle; the middle
     one is chosen. When the edge run is more than twice as strong, it is still chosen.
2. State the half-pixel convention in the doc comments of `toBox`, `toPx` and `boxFromQuad`
   (`geometry.ts:5-39`) and of `analyseBox`. Say whether a box edge lies on a pixel edge or on a pixel
   centre, matching what the code actually does.
3. `pdfTextValues` (`pdf-text.ts:24-41`): join text items that form one dimension across several runs,
   for example `"2."` + `"50"`. Join only when all of these hold:
   - same angle (±1°);
   - same baseline (±25 % of the height);
   - the gap between them is under 30 % of the height;
   - the joined text passes `exactDimension`.
   - Unit tests: a split value is found once, with the union box. Two separate values side by side are
     not joined. A vertical split value is joined too.
4. The unit-test gaps:
   - `analyseBox` on a 180° run and on a real 30° text line;
   - a text-layer run pushed out of the drawing area by the trim offset;
   - tightening to ink in the text layer: `fromPdfText` on a page that has ink;
   - a vertical `makeEdit`;
   - detection when the OCR scan returns no values;
   - schema bounds: confidence < 0 and > 100, an id of 65 characters, `readValue` and `box` given as a
     string or an array, `fontPx`;
   - the drawing-area checks exactly on x0, x1, y0 and y1;
   - all four corners of the 58° box inside the drawn rectangle;
   - floats in `editor-geometry.test.ts` compared with the existing `close` helper instead of `toEqual`.
5. `dragBox` reads the canvas box once (`e2e/support/sheets.ts:136-138`). In TC-35 (`e2e/tools.spec.ts`)
   and near `e2e/export.spec.ts:106`, replace `waitForTimeout` with a wait for the expected absence or
   presence.

- [ ] **Step 1:** Write the new unit tests. Run `npx vitest run tests/unit`. Expected: only the tests for
  items 1 and 3 fail.
- [ ] **Step 2:** Implement items 1–3. Expected: all unit tests pass.
- [ ] **Step 3:** Make item 5's changes. Run
  `timeout 900 npx playwright test e2e/tools.spec.ts e2e/export.spec.ts e2e/pixels.spec.ts e2e/detect.spec.ts`.
  Expected: all passed. A change to `analyseBox` must keep TC-30 and TC-36 passing.
- [ ] **Step 4: Commit:**
  - `fix(editor): a split text-layer value is read as one, and the run nearest the centre wins a close call`
  - `test(editor): cover angles, edges, trim offsets, schema bounds and empty scans`

### Task 5: Admin and copy fixes, and error messages that say what to do (NFR-07)

**Files:**
- Modify:
  - `src/admin/trash-actions.ts`
  - `src/app/(app)/admin/trash/purge-dialog.tsx`
  - `src/messages/vi.ts`, `src/messages/en.ts`
  - `docs/design/spec-sheet-editor-design.md` (the Admin window decision)
- Test: `tests/unit/messages.test.ts` (extend)

**Requirements:**
1. Remove the unreachable `forbidden` result of permanent deletion: `trash-actions.ts:25` (type), `:62`
   (mapping) and `purge-dialog.tsx:74`. `requireAdmin()` runs first. A role lost mid-request now reads
   as the generic failure. Keep the database's own check, which is unchanged.
2. The Admin area below 1024 px.
   - Decided: accept that the server still reads the page data on a narrow window. Admins are few, every
     read is paged, and RLS applies.
   - Record this in the design under NFR-06 ("The Admin area hides itself below 1024 px with a notice;
     its server reads still run, by decision 2026-10-09") and in the roadmap's M7a result. No code
     change.
3. Draw box hint: en `"Press Esc to cancel."`, vi `"Nhấn Esc để huỷ."` (`en.ts:138`, `vi.ts:136`).
4. NFR-07, error messages that state the cause and how to fix it.
   - Go through every string under an `errors` key, and every other string that reports a failure, in
     `src/messages/en.ts`. For each, check it says (a) what went wrong and (b) what the person can do.
   - Where (b) is missing, add it in both languages, for example "Try again." or "Ask an Admin to …".
     Keep the Table B.1 wording unchanged where the design fixes it.
   - Put the list of strings you changed, before → after, in the report.
5. Extend `tests/unit/messages.test.ts`: no value in either dictionary is empty, and the two dictionaries
   have the same placeholders (`{name}`, `{n}`, …) for every key.

- [ ] **Step 1:** Write the message test extension. Run it. Expected: it passes or fails only on real
  placeholder mismatches. Fix them.
- [ ] **Step 2:** Make items 1, 3 and 4.
- [ ] **Step 3:** Run `npx vitest run tests/unit`, `npm run lint`, `npm run typecheck`,
  `timeout 900 npx playwright test e2e/admin.spec.ts` (the purge test touches item 1), and
  `timeout 600 npx playwright test e2e/tools.spec.ts`. The specs match some messages by regular
  expression; update those that matched changed copy.
- [ ] **Step 4:** Item 2's documentation.
- [ ] **Step 5: Commit:**
  - `fix(admin): drop the unreachable forbidden result of permanent deletion`
  - `fix(copy): every error message says what to do next`
  - `docs(design): the Admin area keeps its server reads on narrow windows`

### Task 6: The test cases without a test, and a sturdier end-to-end harness

**Files:**
- Create: `e2e/session.spec.ts`, `e2e/storage.spec.ts`
- Modify: `tests/sql/admin.test.ts` (TC-60), `tests/unit/admin-purge.test.ts` and
  `tests/unit/admin-orphans.test.ts` (TC-75 in the test names), `e2e/admin.spec.ts`,
  `e2e/support/settings.ts`

**Requirements:**
1. **TC-06** (`e2e/session.spec.ts`, fresh context with no storage state):
   - open `/sheets/<id>` of a sheet the Staff account owns, and expect `/login`;
   - sign in as Staff (the password comes from the global setup: follow how `admin.spec.ts` signs Staff B
     in, and reuse its helper rather than copying it);
   - expect `/sheets/<id>`.
2. **TC-07:** sign in, open `/sheets`, Sign out, then `page.goBack()`. The list is not shown: the URL is
   `/login`, or the sheet list's heading and rows are absent.
   - If the browser shows the list from its back-forward cache, the pages must send
     `Cache-Control: no-store`. Check what `/sheets` sends and fix it if needed.
   - Use a separate session, so the shared Staff storage state is not signed out. Signing out of one
     session does not end the others: check that `signOut` uses `scope: "local"`, and if it uses
     `global`, use a throwaway sign-in of Staff B.
3. **TC-53:**
   - at 390 × 844, `/sheets/<id>` shows the editor's desktop notice and no canvas;
   - at 360 × 800, `/sheets` shows the list and the Upload button, and
     `document.documentElement.scrollWidth <= clientWidth`.
4. **TC-51** (`e2e/storage.spec.ts`):
   - with the secret-key test client (`admin()` in `e2e/support/db.ts`), upload a tiny synthetic file
     under a test folder `e2e-tc51-<random>/probe.txt`;
   - create a signed URL valid for 1 second, wait 3 seconds, and fetch it;
   - the response is not 2xx, and the body names an expiry (`/expired/i`);
   - delete the probe in `finally`.
5. **TC-60** (`tests/sql/admin.test.ts`): two admins demote each other at the same moment.
   - Use two separate connections from the harness, each in its own transaction with
     `set local role authenticated` and its JWT claims, as the existing tests do. Each calls
     `set_user_role(<other>, 'user')`.
   - Run both with `Promise.allSettled`. Exactly one succeeds, and exactly one active Admin remains.
   - Roll both back.
   - It cannot run on this network: run `npm run typecheck` and report it as written, not run.
6. **TC-75:** prefix the names of the existing tests that cover it with `TC-75`
   (`tests/unit/admin-purge.test.ts:47-52` and the orphan selection test).
7. **Harness:**
   - In `e2e/admin.spec.ts:160-162` and `:443-444`, run the `finally` restores with
     `Promise.allSettled`, then throw an `AggregateError` of the failures. A failing `resignStaffB` must
     no longer skip `deleteSheetsOf`.
   - `snapshotSettings` (`e2e/support/settings.ts:30`) writes to `<file>.tmp` and then `rename`s it.
8. Do not add a test for TC-01, TC-02, TC-54 or TC-64. Google sign-in is off, and the first production
   Admin is a release step. Task 9 records them.

- [ ] **Step 1:** Write the new specs. Run
  `timeout 900 npx playwright test e2e/session.spec.ts e2e/storage.spec.ts`. Expected: all passed. If a
  test fails because the app is wrong (for example TC-07 and the cache), fix the app.
- [ ] **Step 2:** Make the TC-60 test, the TC-75 names and the harness changes. Run
  `npx vitest run tests/unit`, `npm run typecheck` and `timeout 900 npx playwright test e2e/admin.spec.ts`.
- [ ] **Step 3: Commit:**
  - `test(e2e): sign-in return, sign-out and Back, narrow screens and expired links`
  - `test(sql): two admins demoting each other at once`
  - `test(e2e): restores in the admin tests are independent; the settings snapshot is written atomically`

### Task 7: The user guide (VI/EN) with screenshots

> Note (2026-10-10): the screenshots no longer live in `public/guide`. They are in `src/app/(app)/guide/shots/<locale>/`, so each image is served once (imported by the page and not also copied to `public/`). The task text below is kept as it was written.

**Files:**
- Create:
  - `src/app/(app)/guide/page.tsx` (and small components beside it if needed)
  - `e2e/guide/shots.capture.ts`
  - `playwright.guide.config.ts`
  - `public/guide/vi/*.jpg`, `public/guide/en/*.jpg`
  - `public/guide/vi/points.json`, `public/guide/en/points.json`
  - `e2e/guide.spec.ts`
  - `tests/unit/guide.test.ts`
- Modify: `src/messages/vi.ts`, `src/messages/en.ts` (new `guide` section; `common.guide`),
  `src/ui/app-header.tsx` (the Guide link after Sheets), `package.json` (`guide:shots`)

**Requirements:**
- Route `/guide`, for any signed-in person, under the `(app)` layout. The header shows
  "Hướng dẫn" / "Guide" after "Sheets" for everyone.
- Sections, in this order. Each has a short lead, numbered steps and, where it helps, one screenshot with
  numbered callouts that match the steps.
  1. **Sign in and language**: sign-in with the email and the password an Admin issued; the forced
     password change; Change password; the VI/EN switch.
  2. **Upload a sheet**:
     - accepted files: PDF, PNG or JPG, up to the maximum size, which is read from the settings and shown
       with its current value;
     - the template check;
     - the low-resolution warning;
     - multi-page PDFs (page 1 is used).
  3. **Find sheets**: search, Trash, restore.
  4. **Edit values**:
     - markers, and the locked zones;
     - clicking a marker opens the popover, where you confirm the old value and type the new one;
     - revert;
     - read on click for a value with no marker;
     - Draw box (`K`) with the angle choice;
     - the "apply there too" offer;
     - renaming.
  5. **Save**: `Ctrl`+`S`, the conflict dialog, saving while offline, and leaving with unsaved changes.
  6. **Export**: PNG or PDF, the pre-export check, the file name, and the rule that nothing exported is
     stored on the server.
  7. **Keyboard shortcuts**: a table taken from the code, not from memory. Search
     `src/app/(app)/sheets/[id]` for `key ===` and `e.key`, and list exactly what exists.
  8. **When something goes wrong**: the five most likely messages, quoted from the dictionaries (template
     mismatch, file too large, reader could not load, someone else saved first, account suspended), each
     with what to do.
  9. **For Admins** (rendered only when `me.role === "admin"`): users (role, suspend, issue a password);
     access lists and settings (the lists gate only Google sign-ins); the audit log and CSV; Trash,
     permanent deletion and the orphan clean-up.
- A table of contents at the top links to each section (`id` anchors).
- The page is readable from 360 px. Screenshots scale to the column width (`max-width: 100%`). Callouts
  are absolutely positioned numbered circles placed by percentages from `points.json`, so they stay on
  target at any width. Each image has a real `alt` from the dictionaries.
- Screenshots:
  - `npm run guide:shots` runs `playwright test -c playwright.guide.config.ts`. That config reuses the
    normal global setup and teardown, has `testDir: "e2e/guide"`, `testMatch: "**/*.capture.ts"` and
    `timeout: 300_000`, so the normal `npm run e2e` (`**/*.spec.ts`) never runs it.
  - The capture uses synthetic sheets only (`valuesPdf`, `drawValuesPng` and the other helpers in
    `e2e/support/`) and the reserved accounts.
  - Viewport 1440 × 900, light theme. JPEG quality 80 at `public/guide/<locale>/<name>.jpg`.
  - The capture runs once per locale, setting the `locale` cookie.
  - For each shot it writes callout positions to `points.json` as
    `{ "<name>": [{ "n": 1, "x": 12.5, "y": 40.2 }, …] }`, with x and y as percentages of the image. Each
    position is the centre of the element's bounding box, from `locator.boundingBox()`.
  - Use `locator.boundingBox()` rather than functions passed to `page.evaluate`, so no transpiler helper
    reaches the browser.
  - Shots, about nine:
    - `login`;
    - `list` (with the Upload button and the search);
    - `upload` (the dialog);
    - `editor` (markers, value list, toolbar);
    - `popover` (an open edit popover);
    - `draw-box` (the angle dialog after drawing);
    - `export-check` (the pre-export dialog);
    - `admin-users`;
    - `admin-trash`.
  - The capture deletes the sheets it made and restores anything it changed.
- Commit the 18 images and the two `points.json` files. Keep each image under 250 KB.
- Unit test `tests/unit/guide.test.ts`:
  - every shot named in the page's shot list exists in both `public/guide/vi` and `public/guide/en`;
  - each `points.json` has an entry for every shot;
  - every callout number used by a step exists in that shot's points.
- `e2e/guide.spec.ts`:
  - As Staff, `/guide` loads in vi and in en, every image loads (`naturalWidth > 0`), and there is no
    "For Admins" section.
  - As Admin, the section is there.
  - The header link leads to `/guide`.

- [ ] **Step 1:** Write `tests/unit/guide.test.ts` and `e2e/guide.spec.ts`. Run the unit test. Expected:
  FAIL.
- [ ] **Step 2:** Add the dictionary sections in both languages, the page and the header link. The
  Vietnamese copy uses one spelling of "hủy" throughout (match what the rest of `vi.ts` uses).
- [ ] **Step 3:** Write the capture and the config, then run `timeout 900 npm run guide:shots`.
  Expected: 18 images and 2 `points.json` files written.
- [ ] **Step 4:** Look at every image in both languages: no clipped dialog, no stray hover state,
  callouts on their targets. Also open `/guide` at 1440 px and at 360 px in both languages and both
  themes, take screenshots, and look at them. Fix what is wrong and capture again.
- [ ] **Step 5:** Run `npx vitest run tests/unit` and `timeout 600 npx playwright test e2e/guide.spec.ts`.
  Expected: all passed.
- [ ] **Step 6: Commit** in two commits:
  - `feat(guide): an in-app user guide in Vietnamese and English`
  - `docs(guide): screenshots and callout positions for the guide` (the images and the points).

### Task 8: Accessibility (WCAG 2.2 AA), dark mode and a keyboard-only journey

**Files:**
- Create: `e2e/a11y.spec.ts`, `e2e/keyboard.spec.ts` (unless Step 1 shows an existing test already makes
  the whole journey)
- Modify: `package.json` (dev dependency `@axe-core/playwright` at exactly `4.13.0`; run
  `npm install -D -E @axe-core/playwright@4.13.0`), plus whatever the scans find (`src/app/globals.css`
  tokens, components, dictionaries)

**Requirements:**
- `e2e/a11y.spec.ts`:
  - A helper `scan(page, label)` runs
    `new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude("canvas")`
    (the sheet image is a picture of a paper document, not interface). It fails with a readable list:
    rule id, impact, the first three targets of each violation.
  - Each screen is scanned in light and in dark (`page.emulateMedia({ colorScheme })`). The sheet list
    and the editor are scanned in Vietnamese and in English, set through the `locale` cookie.
  - Screens:
    - `/login`, signed out;
    - `/sheets` with at least one sheet;
    - the Trash tab;
    - the upload dialog open;
    - the editor with markers;
    - the edit popover open;
    - the angle dialog after Draw box;
    - the matching prompt;
    - the export check dialog;
    - `/account/password`;
    - `/guide`;
    - as Admin: `/admin/users`, `/admin/access`, `/admin/audit`, `/admin/trash`, and the purge dialog
      open.
  - Each screen also saves a screenshot to `test-results/a11y/<label>-<theme>-<locale>.png`
    (git-ignored) for review.
- Fix every violation. The fix belongs in the code, not in an `exclude` or `disableRules`. The only
  permitted exclusion is `canvas`. If a rule truly cannot apply, stop and report it with the reason
  rather than excluding it.
- Contrast must also hold for the marker and edit colours (`--mark`, `--edit`) against `--surface` in
  both themes wherever they are used as text or as a control's only boundary. WCAG 1.4.11 needs 3:1 for
  non-text, 1.4.3 needs 4.5:1 for text. Check the values with a small script and put the ratios in the
  report.
- Keyboard-only journey (NFR-07), with no mouse at any step:
  1. From `/sheets`, Tab to a sheet and press Enter to open it.
  2. Reach the value list, press Enter on a value, type a new value, press Enter to apply, then
     `Ctrl`+`S` and see it saved.
  3. Open the Export menu, choose PNG, and confirm in the check dialog. A download happens.
  4. `Esc` closes each layer that is open (popover, dialog, menu), and focus returns to the control that
     opened it.
  - Every focused control along the way has a visible focus indicator: compare a screenshot of the
    element before and after focus, or check the computed `outline-style` is not `none`.
- Dark mode: look at the screenshots of every screen in dark. Look for unreadable text, invisible
  borders, white flashes and icons that vanish. The sheet itself stays paper-white by design.

- [ ] **Step 1:** Install the dependency. Write `e2e/a11y.spec.ts` and the keyboard journey. Run
  `timeout 1500 npx playwright test e2e/a11y.spec.ts e2e/keyboard.spec.ts` and record the violations
  found before any fix in the report.
- [ ] **Step 2:** Fix them, re-running the specs until they pass. Look at every saved screenshot in both
  themes and fix what the rules cannot see.
- [ ] **Step 3:** Run `npx vitest run tests/unit`, `npm run lint`, `npm run typecheck`, and
  `timeout 1200 npx playwright test e2e/editor.spec.ts e2e/tools.spec.ts e2e/admin.spec.ts`. Fixes may
  change roles or names that those specs use. Expected: all passed.
- [ ] **Step 4: Commit:** first `test(a11y): WCAG 2.2 AA scans in both themes and a keyboard-only
  journey`, then one or more `fix(a11y): …` commits named after what they fix.

### Task 9: Test-case status, dependency audit, documentation and the full run on a production build

**Files:**
- Create: `docs/testing/test-case-status.md`
- Modify: `README.md`, `docs/plans/2026-10-07-spec-sheet-editor-roadmap.md` (an "M7a result" section),
  `docs/design/spec-sheet-editor-design.md` (only where M7a changed a decision: the CSP)

**Requirements:**
- `docs/testing/test-case-status.md`: one row for each of TC-01 – TC-77, with these columns:
  - id;
  - title (from the design table);
  - type;
  - where (file and test name);
  - status, as exactly one of:
    - `Pass (2026-10-xx, e2e:prod)`;
    - `Pass (unit)`;
    - `Written; SQL not run on this network`;
    - `Waived until Google sign-in is switched on (owner to confirm)`, for TC-01, TC-02, TC-64;
    - `Release step (M7b)`, for TC-54;
    - `Needs a macOS machine (owner)`, for TC-47;
    - `Bench (M2 result)`, for TC-20.
  - Then a second table for NFR-01 – NFR-10 with the evidence: test names, the `[timing]` numbers, the
    CSP and bundle check, the a11y spec.
  - Statuses must be true: take them from the final run's output, not from memory.
- Dependency audit:
  - `npm audit --omit=dev` must report 0. Record the date.
  - `npm audit` (with dev dependencies) currently reports 5 high findings in the `braces` chain under
    `eslint-config-next`. No fix exists that does not downgrade Next.js's ESLint config. They are
    development-only and never in the browser bundle or on the server. Record this in the README under
    "Dependency audit", with the date and the command, so the owner can accept it.
- README:
  - the scripts table gains `e2e:prod`, `guide:shots` and the `postbuild` bundle check;
  - the end-to-end section lists the new specs and the current full-run time;
  - a short "Security headers" paragraph says where the CSP lives and how to extend it, for example when
    a new third-party origin is needed.
- Roadmap "M7a result", in the style of the M6 result section: commits, the measured numbers (unit
  count, end-to-end count and run time on the production build, the `[timing]` lines), and what is left
  for M7b. It also lists the carried items closed without a change, each with its reason:
  - the reader keeps its first page once it is starting, by design (documented in
    `use-value-reader.ts`);
  - the reader hook has no unit test: the end-to-end tests cover it, and no React test renderer was
    added;
  - three items had no clear wording to act on: the "stale prompt" test, the "detected" and matching
    prompt copy, and the English unknown-error message on the users page. Kept as they are, for the owner
    to reword if wanted;
  - a read on click while the export dialog is open: the dialog is modal and covers the canvas.
- Full run: stop the dev server, then `timeout 3000 npm run e2e:prod`. Every spec must pass on the
  production build. Then check the shared state is clean with the read-only script the controller gives
  you (settings 20/2000/2/10, the reserved accounts active Staff except `e2e-admin` suspended, no test
  access entries, no sheets left by the reserved accounts).

- [ ] **Step 1:** Run the full suite on the production build and save its full output to
  `test-results/m7a-full-run.log`. Do not trim it.
- [ ] **Step 2:** Write the status table from that log and the unit run.
- [ ] **Step 3:** Update the README, the roadmap and the design.
- [ ] **Step 4: Commit:** `docs(release): test-case status, dependency audit and the M7a result`.
