# Test-case status

Status of the 77 test cases of the design (section 8) and of NFR-01 to NFR-10, as of 2026-10-10 on branch
`feat/m7a-hardening`.

Sources:

- End-to-end: the full run `npm run e2e:prod` against a production build (`next build` + `next start`):
  88 passed and 1 failed (20.5 minutes); the one failure was a mistake in the test and, after the fix,
  the whole `admin` spec passed again alone (9 tests, 3.1 minutes). Section "Full run" gives the detail.
- Unit: `npx vitest run tests/unit`: 45 files, 295 tests, all passing.
- SQL: `tests/sql/` needs the Postgres pooler port, which the network used for this run blocks. These
  suites are written and type-checked but were not run here. TC-60 is new in M7a and has never run.

## Test cases

| Id | Title | Type | Where | Status |
|---|---|---|---|---|
| TC-01 | Permitted domain | E2E | - | Waived until Google sign-in is switched on (owner to confirm) |
| TC-02 | Other domain | E2E | - | Waived until Google sign-in is switched on (owner to confirm) |
| TC-03 | Look-alike domains | SQL | `tests/sql/access.test.ts` | Written; SQL not run on this network |
| TC-04 | Upper case | SQL | `tests/sql/access.test.ts` | Written; SQL not run on this network |
| TC-05 | Direct API call without permission | SQL | `tests/sql/access.test.ts` | Written; SQL not run on this network |
| TC-06 | Not signed in | E2E | `e2e/session.spec.ts` TC-06 a sheet link opened signed out leads to sign-in and back | Pass (2026-10-10, e2e:prod) |
| TC-07 | Sign out | E2E | `e2e/session.spec.ts` TC-07 (two tests: Back after sign-out; sign-out on one computer keeps the other) | Pass (2026-10-10, e2e:prod) |
| TC-08 | Matching PDF | E2E | `e2e/upload.spec.ts` TC-08 | Pass (2026-10-10, e2e:prod) |
| TC-09 | Low-resolution PNG | E2E | `e2e/upload.spec.ts` TC-09 | Pass (2026-10-10, e2e:prod) |
| TC-10 | Rotated JPG | Unit | `tests/unit/orientation.test.ts` | Pass (unit) |
| TC-11 | Transparent PNG | Unit | `tests/unit/flatten.test.ts` | Pass (unit) |
| TC-12 | Drawing-only crop | E2E | `e2e/upload.spec.ts` TC-12; `tests/unit/template.test.ts` | Pass (2026-10-10, e2e:prod) |
| TC-13 | Extra white border | Unit | `tests/unit/template.test.ts` trimBounds | Pass (unit) |
| TC-14 | Ratio limits (2% tolerance) | Unit | `tests/unit/template.test.ts` ratioMatches | Pass (unit) |
| TC-15 | Wrong file type | E2E | `e2e/upload.spec.ts` TC-15 | Pass (2026-10-10, e2e:prod) |
| TC-16 | File too large | E2E | `e2e/upload.spec.ts` TC-16 | Pass (2026-10-10, e2e:prod) |
| TC-17 | Password-protected PDF | E2E | `tests/unit/pdf-errors.test.ts` (error mapping; the generator cannot encrypt a PDF, so no full upload path) | Pass (unit) |
| TC-18 | Multi-page PDF | E2E | `e2e/upload.spec.ts` TC-18 | Pass (2026-10-10, e2e:prod) |
| TC-19 | Offline during upload | E2E | `e2e/upload.spec.ts` TC-19 | Pass (2026-10-10, e2e:prod) |
| TC-20 | Scan the 1135-px sample | Bench | M2 benchmark, `research/ocr-bakeoff/`; the editor's OCR path runs in `e2e/detect.spec.ts` (an image sheet is read with OCR) | Bench (M2 result) |
| TC-21 | PDF with a text layer | E2E | `e2e/detect.spec.ts` TC-21 / TC-23 | Pass (2026-10-10, e2e:prod) |
| TC-22 | Decimal-point insertion | Unit | `tests/unit/ocr/dimension-text.test.ts` | Pass (unit) |
| TC-23 | Value outside the drawing | E2E | `e2e/detect.spec.ts` TC-21 / TC-23 | Pass (2026-10-10, e2e:prod) |
| TC-24 | Click a missed value | E2E | `e2e/tools.spec.ts` TC-24; `e2e/perf.spec.ts` read on click | Pass (2026-10-10, e2e:prod) |
| TC-25 | Model download fails | E2E | `e2e/detect.spec.ts` TC-25; `e2e/tools.spec.ts` TC-25 | Pass (2026-10-10, e2e:prod) |
| TC-26 | Reopen a scanned sheet | E2E | `e2e/detect.spec.ts` TC-26 | Pass (2026-10-10, e2e:prod) |
| TC-27 | Edit a vertical value | E2E | `e2e/editor.spec.ts` TC-27 | Pass (2026-10-10, e2e:prod) |
| TC-28 | Machine misread the old value | E2E | `e2e/editor.spec.ts` TC-28 | Pass (2026-10-10, e2e:prod) |
| TC-29 | New value format | Unit | `tests/unit/editor-numbers.test.ts`; `e2e/editor.spec.ts` TC-29 | Pass (2026-10-10, e2e:prod) |
| TC-30 | Dimension line left intact | Visual | `e2e/pixels.spec.ts` TC-30 | Pass (2026-10-10, e2e:prod) |
| TC-31 | Revert to original | Visual | `e2e/pixels.spec.ts` TC-31; `e2e/editor.spec.ts` TC-31 | Pass (2026-10-10, e2e:prod) |
| TC-32 | Matching value suggestion | E2E | `e2e/tools.spec.ts` TC-32 | Pass (2026-10-10, e2e:prod) |
| TC-33 | Locked zones | E2E | `e2e/editor.spec.ts` TC-33 | Pass (2026-10-10, e2e:prod) |
| TC-34 | Box outside the zone | E2E | `e2e/tools.spec.ts` TC-34 | Pass (2026-10-10, e2e:prod) |
| TC-35 | Empty box | E2E | `e2e/tools.spec.ts` TC-35 | Pass (2026-10-10, e2e:prod) |
| TC-36 | Diagonal value | Visual | `e2e/pixels.spec.ts` TC-36 | Pass (2026-10-10, e2e:prod) |
| TC-37 | Normal save | E2E | `e2e/editor.spec.ts` TC-37 | Pass (2026-10-10, e2e:prod) |
| TC-38 | Two people save | E2E | `e2e/editor.spec.ts` TC-38 | Pass (2026-10-10, e2e:prod) |
| TC-39 | Leave unsaved | E2E | `e2e/editor.spec.ts` TC-39 | Pass (2026-10-10, e2e:prod) |
| TC-40 | Offline save | E2E | `e2e/editor.spec.ts` TC-40 | Pass (2026-10-10, e2e:prod) |
| TC-41 | Sheet trashed while open | E2E | `e2e/editor.spec.ts` TC-41 | Pass (2026-10-10, e2e:prod) |
| TC-42 | PDF without text layer | E2E | `e2e/export.spec.ts` TC-42 | Pass (2026-10-10, e2e:prod) |
| TC-43 | PDF from an image | E2E | `e2e/export.spec.ts` TC-43 | Pass (2026-10-10, e2e:prod) |
| TC-44 | PNG size | E2E | `e2e/export.spec.ts` TC-44 | Pass (2026-10-10, e2e:prod) |
| TC-45 | Pre-export dialog | E2E | `e2e/export.spec.ts` TC-45 | Pass (2026-10-10, e2e:prod) |
| TC-46 | File name | Unit | `tests/unit/editor-export-plan.test.ts` | Pass (unit) |
| TC-47 | Same render on two machines | Visual | - | Needs a macOS machine (owner) |
| TC-48 | Trash and restore | E2E | `e2e/list.spec.ts` TC-48 | Pass (2026-10-10, e2e:prod) |
| TC-49 | Users cannot delete files | SQL | `tests/sql/access.test.ts` | Written; SQL not run on this network |
| TC-50 | Reading files without permission | SQL | `tests/sql/access.test.ts` | Written; SQL not run on this network |
| TC-51 | Expired link | E2E | `e2e/storage.spec.ts` TC-51 | Pass (2026-10-10, e2e:prod) |
| TC-52 | More than 1,000 sheets | E2E | `e2e/list.spec.ts` TC-52 | Pass (2026-10-10, e2e:prod) |
| TC-53 | Narrow screens | E2E | `e2e/session.spec.ts` TC-53 | Pass (2026-10-10, e2e:prod) |
| TC-54 | First Admin | E2E | - | Release step (M7b) |
| TC-55 | Staff opens the Admin area | E2E | `e2e/admin.spec.ts` TC-55 | Pass (2026-10-10, e2e:prod) |
| TC-56 | Staff calls admin functions | SQL | `tests/sql/admin.test.ts` | Written; SQL not run on this network |
| TC-57 | Self-promotion | SQL | `tests/sql/access.test.ts` | Written; SQL not run on this network |
| TC-58 | Grant Admin | E2E | `e2e/admin.spec.ts` TC-58 | Pass (2026-10-10, e2e:prod) |
| TC-59 | Revoke the last Admin | SQL | `tests/sql/admin.test.ts` | Written; SQL not run on this network |
| TC-60 | Two Admins demote each other at once | SQL | `tests/sql/admin.test.ts` (new in M7a, never run) | Written; SQL not run on this network |
| TC-61 | Self-suspension | SQL | `tests/sql/admin.test.ts` | Written; SQL not run on this network |
| TC-62 | Suspend an active user | E2E | `e2e/admin.spec.ts` TC-62 / TC-63 | Pass (2026-10-10, e2e:prod) |
| TC-63 | Reinstate | E2E | `e2e/admin.spec.ts` TC-62 / TC-63 | Pass (2026-10-10, e2e:prod) |
| TC-64 | Individual email | E2E | Access lists spec covers add and remove of an email in `e2e/admin.spec.ts` ("Access lists: add a domain and an email..."); the sign-in itself needs Google | Waived until Google sign-in is switched on (owner to confirm) |
| TC-65 | Self-lockout via domain | SQL | `tests/sql/admin.test.ts` | Written; SQL not run on this network |
| TC-66 | Change maximum file size | E2E | `e2e/admin.spec.ts` TC-66 | Pass (2026-10-10, e2e:prod) |
| TC-67 | Change ratio tolerance | E2E | `e2e/admin.spec.ts` TC-67 | Pass (2026-10-10, e2e:prod) |
| TC-68 | Complete logging | E2E | `e2e/admin.spec.ts` TC-68 / TC-72 | Pass (2026-10-10, e2e:prod) |
| TC-69 | Append-only | SQL | `tests/sql/audit.test.ts` | Written; SQL not run on this network |
| TC-70 | Forged action | SQL | `tests/sql/audit.test.ts` | Written; SQL not run on this network |
| TC-71 | Staff reads the log | SQL | `tests/sql/audit.test.ts` | Written; SQL not run on this network |
| TC-72 | CSV export | E2E | `e2e/admin.spec.ts` TC-68 / TC-72 | Pass (2026-10-10, e2e:prod) |
| TC-73 | Purge a sheet not in the Trash | SQL | `tests/sql/admin.test.ts` | Written; SQL not run on this network |
| TC-74 | Typed confirmation | E2E | `e2e/admin.spec.ts` TC-74 | Pass (2026-10-10, e2e:prod) |
| TC-75 | File deletion fails midway | Unit | `tests/unit/admin-purge.test.ts`, `tests/unit/admin-orphans.test.ts` | Pass (unit) |
| TC-76 | Orphan clean-up | E2E | `e2e/admin.spec.ts` TC-76; `tests/unit/admin-orphans.test.ts` | Pass (2026-10-10, e2e:prod) |
| TC-77 | Service-role key not exposed | Unit | `tests/unit/bundle-scan.test.ts`; the `postbuild` check `scripts/check-bundle.mts` | Pass (unit) |

Counts: 3 x Waived until Google sign-in is switched on (owner to confirm); 15 x Written; SQL not run on this network; 47 x Pass (2026-10-10, e2e:prod); 9 x Pass (unit); 1 x Bench (M2 result); 1 x Needs a macOS machine (owner); 1 x Release step (M7b).

Not covered by a test: TC-17 has no full upload path (the test-file generator cannot encrypt a PDF; the
error mapping is unit-tested).

## Non-functional requirements

| Id | Evidence | Status |
|---|---|---|
| NFR-01 Performance | `e2e/perf.spec.ts` on the production build. Opening a saved sheet: `[timing] reopen-1 1857 ms`, `reopen-2 1848 ms`, `reopen-3 2372 ms` (limit 3 s). Read on click: `[timing] read-on-click 916 ms` (limit 5 s). PDF export: `[timing] export-pdf 1265 ms` (limit 5 s). The first scan of an image (60 s) was measured in M2 and the editor's OCR path runs in `e2e/detect.spec.ts`. | Pass (2026-10-10, e2e:prod) |
| NFR-02 Security | RLS and the three layers: SQL suites (not run on this network) and `e2e/admin.spec.ts` TC-55. Content-Security-Policy with a per-request nonce: `tests/unit/csp.test.ts` and `e2e/csp.spec.ts` (5 tests: header with a fresh nonce on every load, a missing page, the thumbnail, OCR detection with PNG and PDF export, the Admin pages; no violation). | Pass (unit, e2e:prod); SQL written, not run on this network |
| NFR-03 Privacy | `e2e/csp.spec.ts`: `connect-src` and `img-src` name only the app and the Supabase project, so an image cannot be sent anywhere else; OCR runs in the browser (`e2e/detect.spec.ts`). | Pass (2026-10-10, e2e:prod) |
| NFR-04 Integrity | `tests/sql/access.test.ts` TC-49 (not run on this network); permanent deletion only through the server job: `e2e/admin.spec.ts` TC-74 and `tests/unit/admin-purge.test.ts`. | Pass for the server job; SQL written, not run on this network |
| NFR-05 Consistency | Arimo ships with the app; `e2e/pixels.spec.ts` and `e2e/export.spec.ts` TC-44 compare pixels on this machine. The Windows to macOS comparison is TC-47. | Needs a macOS machine (owner) |
| NFR-06 Compatibility | `e2e/session.spec.ts` TC-53 (editor desktop notice at 390 px, list at 360 px); the Admin area notice below 1024 px. Chrome only in the test run. | Pass (2026-10-10, e2e:prod) |
| NFR-07 Usability | `e2e/a11y.spec.ts`: axe scans for WCAG 2.2 AA in light and dark, Vietnamese and English, on the login page, the sheet list, the upload dialog, the editor and its layers, the trash, the password page, the guide, the Admin screens and the purge dialog (9 tests, all passing). `e2e/keyboard.spec.ts`: open, edit, save and export with the keyboard alone. | Pass (2026-10-10, e2e:prod) |
| NFR-08 Test data | `samples/` is in `.gitignore`; all tests use generated sheets. | Pass (by inspection) |
| NFR-09 Traceability | `e2e/admin.spec.ts` TC-68 / TC-72 (one audit entry per action; the CSV matches the log); SQL TC-69 to TC-71 not run on this network. | Pass for the end-to-end part; SQL written, not run on this network |
| NFR-10 Least privilege | `tests/unit/bundle-scan.test.ts` and the `postbuild` check `scripts/check-bundle.mts` (the production bundle holds no secret-key shape); `createSupabaseAdmin` gained no new use in M7a. | Pass (unit, build check) |

## Full run

Command: `npm run e2e:prod` (a production build served by `next start`; the dev server on port 3000 must
be stopped first). Result of the first run: 88 passed, 1 failed, 20.5 minutes.

The failure was `e2e/admin.spec.ts` TC-62 / TC-63. The test checked that the login page had no element with
role `alert`, but the production build keeps an empty route announcer with that role on every page. The
failure repeated when the spec ran alone, so it was not a flake. The check now looks for an alert with
the suspension text. After the change the whole `admin` spec passed on the production build (9 tests, 3.1 minutes).

During the run the server logged `logExport failed: sheet_not_found` twice. That is the export log call
of a sheet that the test had already deleted; no test failed because of it.

After the run the shared development project was checked with a read-only script: settings 20 / 2000 / 2 / 10,
`e2e-staff` and `e2e-staff-b` active Staff, `e2e-admin` suspended, `admin@ctyhp.vn` still an active Admin,
only `ctyhp.vn` in the permitted domains, no permitted emails, 0 sheets.
