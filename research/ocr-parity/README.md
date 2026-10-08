# OCR parity fixtures

`make_fixtures.py` runs RapidOCR 3.9.2's own `DBPostProcess` (text detection post-processing) and
`CTCLabelDecode` (recognition decoding) on synthetic inputs and writes the inputs and outputs to
`tests/unit/ocr/fixtures/`. The unit tests check that the TypeScript ports in `src/lib/ocr/` give the
same results (boxes within 2 px, scores within 0.02).

No sheet image is involved. Re-run the script only when a synthetic case changes; see the header of
`make_fixtures.py` for the commands.
