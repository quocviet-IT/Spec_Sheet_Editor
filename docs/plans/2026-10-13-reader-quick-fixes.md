# Value Reader Quick Fixes Implementation Plan

> Work through the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 of the value-reader upgrade, approved by the owner on 2026-10-13.
- Every value keeps its true angle, so a rotated value is re-drawn at its own angle and digit height.
- Fewer values are missed.
- Fewer values are read wrongly.

No model change, no database change.

**Background (measured in the 2026-10-13 audit, 148 values with known truth):**
- The detector's quad is already turned with the text (within 1–4°), but `src/lib/ocr/pipeline.ts:109` keeps only a quarter turn. `src/lib/ocr/scan.ts:66` and `src/lib/ocr/click.ts:68` store that snapped angle. Measurement then runs across the slanted ink, and new digits come out ×1.4–2.7 too tall (up to ×6), drawn upright.
- Values are lost or misread in these ways:
  - Ø read as "0", which the filter rejects (`src/lib/ocr/dimension-text.ts:2`);
  - "2X" count prefixes;
  - upside-down crops in the scan, never re-read;
  - a 58 px merge window that drops different values standing close together (`scan.ts:20-34`);
  - the 3–4-digit repair turning partial readings into wrong values ("069" → 0.69);
  - an extension line read as a leading "1" in clicks ("10.85" for 0.85).
- Prototypes of each fix raised "edited correctly" from 41 to 88 of 148 (scan) and from 45 to 87 (click), and "read" from 108 to 139, with no strays.

**Architecture:**
- **Angle.**
  - A pure helper turns a reading's quad and turn into the text's angle, snapped to an axis within 4°.
  - A pixel helper searches ±12° around a free angle for the angle at which the digits measure least tall.
  - Both are used wherever a reading or a drawn box becomes a detection (scan, click, drawn box).
- **Recognition text** is normalised before the dimension filter. A recognised prefix (Ø, R, a count such as "2X") is kept with the detection and re-drawn in front of the new value.
- **The scan** merges by same value or overlapping quads, and re-reads upside-down crops.
- **Guards** stop the readings that produced wrong values.

**Tech Stack:** TypeScript, Next.js 16.3.8 client and Web Worker code, `onnxruntime-web` 1.30.0 (unchanged), Zod 4 (stored-data schema), Vitest 4.

## Global Constraints

- Repo is **public**: never commit real sheets, their names, SO/MO numbers, crops of them, or keys. Real sheets
  stay in the git-ignored `samples/` folder.
  - Stage files one by one by path. Never use `git add -f`, `git add -A` or `git add .`; git-ignored local scratch
    files must never be committed.
- File names, commit messages and documents are in English. The only Vietnamese text is interface copy in
  `src/messages/vi.ts`, plus the language's name on the VI/EN switch.
- Commits carry no attribution trailer of any kind and no tool names.
- **Stored sheets stay readable.** Any new field in stored detections or edits is optional, and old JSON parses
  unchanged (`src/editor/schema.ts`).
- **Angles stored are in (-180, 180]**, rounded with `roundAngle`. Axis-aligned values keep exactly 0, 90, -90 or
  180.
- The PDF text-layer path (`src/editor/pdf-text.ts`) already has exact angles. Do not change its angle; it benefits
  only from the shared fixes.
- **Scan time (TC-20, NFR-01):** a full scan must stay within 60 s on the browser bench. Any extra pass that cannot
  meet this stays out.
- Run `npx vitest run tests/unit`, `npm run lint`, `npm run typecheck` and `npm run build`. No Playwright runs.

---

### Task 1: The true angle of every value

**Files:**
- Modify:
  - `src/editor/geometry.ts` (+ `angleFromQuad`, `snapAngle`)
  - `src/editor/pixels.ts` (+ `refineAngle`)
  - `src/editor/detections.ts` (`fromScan`)
  - `src/app/(app)/sheets/[id]/editor.tsx` (`readAt`, `onAngle`)
  - and, if cleaner, `src/lib/ocr/scan.ts` / `click.ts` (return the quad's angle instead of the snapped one)
- Test:
  - `tests/unit/editor-geometry.test.ts`
  - `tests/unit/editor-pixels.test.ts`
  - `tests/unit/editor-detections.test.ts`
  - a new `tests/unit/free-angle-edit.test.ts` (the regression)

**Interfaces:**
- `angleFromQuad(quad: Quad, turn: 0 | 90 | 180 | 270, imageTurn: number): number`. It gives the reading direction
  in page coordinates, in degrees (the convention in `src/editor/types.ts`):
  - for turn 0 or 180 the text runs from the first corner to the second (`tl → tr`);
  - for 90 or 270 it runs `tl → bl`;
  - add 180 when the turn is 180 or more;
  - then add the pass's own image turn.
  
  Check the corner order against `orderClockwise` (`src/lib/ocr/geometry.ts:108-113`) and `cropQuad`
  (`src/lib/ocr/raster.ts:232-260`), and prove it with tests at 0, ±15, ±30, ±45, ±60, ±75, ±90 and 180.
- `snapAngle(angle: number, tolerance = 4): number` returns 0, 90, -90 or 180 when within the tolerance, else the
  angle unchanged (normalised).
- `refineAngle(raster: Raster, box: PxBox, span = 12, step = 0.5): PxBox`:
  - When `box.angle` is an axis angle it returns the box unchanged.
  - Otherwise it measures `analyseBox` at `angle + k·step` for `|k·step| ≤ span` and keeps the angle whose tight
    height is smallest.
  - It keeps the original when no candidate is at least 1 px less tall.
  - It also keeps the original when the best candidate lies at the edge of the range and the quad itself is
    trusted. Avoid drifting along a crowded line.
  - It returns the tightened box at that angle.

- [ ] **Step 1: Regression test first** (`tests/unit/free-angle-edit.test.ts`). Draw a value at 30° on a
  synthetic raster: ink blocks along a 30° axis, 13 px tall, with a parallel dimension line 4 px away.
  - Build the quad the detector would return, a rectangle turned 30° around the text.
  - Run the same steps the scan runs, `boxFromQuad` → `toDetection` → `makeEdit`. With the stored angle the app
    uses today (0), `fontPx·W` is about 39 px; with the fix it must be 13 ± 1 px and the angle 30 ± 1.
  - Repeat at -45° and 60°.
  - The test fails on the current code.
- [ ] **Step 2: Unit tests** for `angleFromQuad` (each angle and turn, including an upside-down reading),
  `snapAngle` (3.9° → 0, 4.1° stays, 86° → 90, -177° → 180) and `refineAngle`:
  - It moves a box given at 25° to 30 ± 0.5 on a 30° value.
  - It leaves 0° and 90° boxes alone.
  - It does not move when nothing improves.
- [ ] **Step 3: Implement.**
  - Scan and click readings get `angle = snapAngle(angleFromQuad(...))`, then `refineAngle` for free angles, in
    one place shared by `fromScan` and the editor's `readAt`.
  - A drawn box (`onAngle`) uses `refineAngle` around the person's angle, including when they chose a free
    angle; an axis choice stays exact.
  - `makeEdit` re-measures at the detection's stored angle, as today.
- [ ] **Step 4:** Run the unit suites, lint, typecheck and build.
- [ ] **Commit:** `fix(editor): a value keeps the angle it is written at, so a rotated value is re-drawn at its own size`.

### Task 2: Fewer missed and fewer wrong values

**Files:**
- Modify:
  - `src/lib/ocr/dimension-text.ts`
  - `src/lib/ocr/scan.ts`
  - `src/lib/ocr/click.ts`
  - `src/lib/ocr/pipeline.ts`
  - `src/editor/types.ts`, `src/editor/schema.ts` (an optional `prefix`)
  - `src/editor/detections.ts`
  - `src/editor/compose.ts`, `src/editor/canvas.ts` (draw the prefix)
  - `src/editor/matching.ts` (match by value only)
  - `src/lib/ocr/bench/sample.ts` (the editor's frame)
- Test:
  - `tests/unit/dimension-text.test.ts` (or the existing OCR text tests)
  - scan, merge and click tests in `tests/unit`
  - `tests/unit/editor-compose.test.ts`
  - `tests/unit/editor-schema.test.ts`

**Requirements:**
- **Normalise before the filter:**
  - Apply NFKC (full-width digits).
  - Turn "．", "。", "·" and "，" into "." or "," as today's comma rule expects.
  - Treat a leading "0", "O", "o", "Φ", "φ", "ø" or "⌀" that directly precedes a value of the form `[1-9]\d?[.,]\d{2}`
    as the diameter sign Ø.
  - Take the value after a count prefix such as "2X", "2x", "4X" or "(4X)".
  - The value itself still matches `^(0|[1-9]\d?)\.\d{2}$`. The owner has not confirmed other formats yet, so do
    not widen it.
  - Return `{ value, prefix }`, where `prefix` is the normalised text in front of the value ("Ø", "R", "2X Ø", …)
    or "" when there is none.
- **Keep and draw the prefix:**
  - `Detection` and `Edit` gain an optional `prefix?: string`, max 8 characters, Zod-optional so old sheets parse.
  - `planEdit` and the canvas draw `prefix + newValue` with the same font and height, so an edited Ø1.30 becomes
    Ø1.40 instead of losing its Ø. Arimo has Ø.
  - Matching and suggestions compare values only.
  - The value list and the popover show the prefix before the old value.
- **Merge:** replace the 58 px window. A candidate is dropped only when a kept candidate has the same value and
  lies within the window, or when their quads overlap (area of intersection over the smaller quad ≥ 0.5).
  Different values close together are both kept.
- **Upside-down re-read in the scan:**
  - When a reading in the scan is not a dimension with a written decimal point, re-read the same crop turned 180°.
  - Keep whichever reading is a dimension with a written point. When both are, keep the one with the higher score.
  - The quad and turn of the kept reading set the angle, as in Task 1.
- **Guards against wrong values:**
  - In the click, only a reading with a written separator skips trying the other direction.
  - The 3–4-digit repair ("069" → 0.69) applies only when no reading with a written point covers the same place.
  - Between two directions, prefer the one with a written point, then the higher score.
- **±45° scan passes** (optional, measured):
  - Add passes turned ±45° only if the browser bench keeps the full scan of the sample within 60 s.
  - Otherwise leave them out and say so in the report.
  - The measuring is done in Task 3. In this task put them behind a constant that is off by default.
- **Bench:** `src/lib/ocr/bench/sample.ts` measures the frame the editor actually uses (from `drawingAreaPx` on the
  trimmed page), not a hand-set frame.
- **Tests:**
  - normalisation cases:
    - "01.30" → { value: "1.30", prefix: "Ø" }
    - "Ø1.30" → the same
    - "2X Ø1.10" → { "1.10", "2X Ø" }
    - "R0.50" → { "0.50", "R" }
    - "１.５０" → "1.50"
    - "069" stays rejected when a pointed reading covers the place
  - merge: two different values 40 px apart are both kept; the same value read twice is merged;
  - the upside-down re-read choice;
  - the click guard;
  - schema compatibility: old JSON without `prefix` parses;
  - compose: the prefix is drawn.
- [ ] Steps: write the failing tests; implement; run the unit suites, lint, typecheck and build.
- [ ] **Commit:** `fix(ocr): Ø and count prefixes are read and kept, close values are no longer merged away, and partial readings no longer become wrong values`.

### Task 3: Measure before and after

**Files:** none committed, apart from an optional short summary in `docs/` with no real sheet names.

- [ ] Measure on the synthetic pages with known truth, and on the real sheets in `samples/` (never committed). For
  the real sheets, count:
  - the values found;
  - those read correctly, checked by eye against the sheet;
  - the wrong values;
  - the angle and digit height for rotated values.

  Do it before (main) and after (this branch), with the same harness.
- [ ] Bench the full scan in the browser for the ±45° passes, and decide on/off by the 60 s rule.
- [ ] Look at re-drawn edits of rotated values: angle, size, and whether the old ink is fully covered.
- [ ] Report the numbers to the owner.
