# Benchmark: reading dimension numbers (2026-10-06)

The benchmark compares OCR engines on one sample sheet with 11 numbers at known positions. The
results and conclusions are in chapter 7 of the
[design document](../../docs/design/spec-sheet-editor-design.md).

**The sample sheet is not in the repository**, because real sheets carry SO/MO order numbers. Put
the sheet at `samples/sample.png` in the repository root (that folder is git-ignored), or point the
`SAMPLE` environment variable at the file. The coordinates of the 11 numbers in `prep.py` belong to
the 1135×877 px sample used on 2026-10-06; another sheet needs its coordinates measured again.

## Run

```bash
python prep.py                      # creates scan/, click/ and truth.json
python clean_click.py               # line-removed variant -> clean/ (scored worse, kept for comparison)

python -m venv .venv && ./.venv/Scripts/python -m pip install rapidocr-onnxruntime
./.venv/Scripts/python run_rapid.py                                  # -> results_rapid.json
./.venv/Scripts/python run_rapid.py clean results_rapid_clean.json skip

npm init -y && npm install tesseract.js@5
node run_tess.js                                                     # -> results_tess.json

python score.py results_rapid.json rule     # 'rule' = restore a lost decimal point ("1630" -> "16.30")
```

## Results on the sample sheet

| | Scan the whole drawing | Click each number |
|---|---|---|
| Tesseract 5 | 5/11 | 3/11 (with the rule) |
| PaddleOCR PP-OCRv4 (RapidOCR 1.3) | located 9/11, read 7/11 | 8/11 |
| PaddleOCR, lines removed first | — | 1/11 |

PaddleOCR run time on the office PC (CPU, Python build): a scan in 3 orientations took 30 seconds;
each click area took about 2.8 seconds.

## Round 2: model generations (does Python help?)

Section 7.3 of the [design document](../../docs/design/spec-sheet-editor-design.md) uses the
results of this round. Round 2 uses RapidOCR 3.9.2 and scans exactly the two orientations in the
design (0° and 90° clockwise). Click mode tries 5 angles (0°, ±60°, ±90°).

```bash
python -m venv .venv2 && ./.venv2/Scripts/python -m pip install rapidocr onnxruntime
./.venv2/Scripts/python run_v3.py v4_mobile      # v4_mobile v5_mobile v6_small v4_server v5_server v6_medium
python metrics.py results_v4_mobile.json results_v5_mobile.json results_v6_small.json
```

| Model | File size | Scan: located | Scan: read correctly | Click: read correctly | Scan per orientation | Per click |
|---|---|---|---|---|---|---|
| PaddleOCR v4, small | 14.9 MB | 9/11 | 7/11 | 8/11 | 12 s | 1.2 s |
| PaddleOCR v5, small | 20.5 MB | 8/11 | 6/11 | 9/11 | 10 s | 3.6 s |
| PaddleOCR v6, small | 29.8 MB | 9/11 | 7/11 | 9/11 | 29 s | 9.2 s |
| v5 server / v4 server / v6 medium | 132–194 MB | did not finish (15–50 minutes) | | | | |

Test machine: Intel Core i3-1315U, 7.7 GB RAM, with only about 0.4 GB free during the runs, so
timings vary from run to run. All three small models read 2.50 as "2.59" when scanning. When
clicking, v6 returned no number for one of the two 2.50s instead of a wrong one.
