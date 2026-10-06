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
