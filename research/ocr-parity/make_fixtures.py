"""Write tests/unit/ocr/fixtures/*.json from RapidOCR's own DBPostProcess and CTCLabelDecode.

Synthetic inputs only (no sheet image). The TypeScript ports in src/lib/ocr must reproduce these
outputs. Regenerate after changing a case:

    python -m venv .venv
    .venv/Scripts/python -m pip install rapidocr==3.9.2 onnxruntime
    .venv/Scripts/python make_fixtures.py
"""
import json
import math
import os

import cv2
import numpy as np
from rapidocr.ch_ppocr_det.utils import DBPostProcess
from rapidocr.ch_ppocr_rec.utils import CTCLabelDecode

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tests", "unit", "ocr", "fixtures")


def rect_poly(cx, cy, w, h, deg):
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    corners = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    return np.array([[round(cx + x * ca - y * sa), round(cy + x * sa + y * ca)] for x, y in corners], dtype=np.int32)


def det_case(name, map_w, map_h, src_w, src_h, shapes):
    prob = np.zeros((map_h, map_w), dtype=np.float32)
    for cx, cy, w, h, deg, value in shapes:
        cv2.fillPoly(prob, [rect_poly(cx, cy, w, h, deg)], float(value))
    post = DBPostProcess(thresh=0.3, box_thresh=0.5, max_candidates=1000, unclip_ratio=1.6,
                         score_mode="fast", use_dilation=True)
    boxes, scores = post(prob[None, None, :, :], (src_h, src_w))
    case = {
        "name": name, "mapW": map_w, "mapH": map_h, "srcW": src_w, "srcH": src_h,
        "shapes": [list(s) for s in shapes],
        "prob": [round(float(v), 4) for v in prob.flatten()],
        "boxes": [[[float(x), float(y)] for x, y in box] for box in boxes],
        "scores": [round(float(s), 4) for s in scores],
    }
    with open(os.path.join(OUT, f"det-{name}.json"), "w", encoding="utf-8") as f:
        json.dump(case, f)
    print(f"det-{name}: {len(boxes)} boxes")


def ctc_case():
    chars = list("0123456789.")
    decode = CTCLabelDecode(character=list(chars))
    classes = len(chars) + 2
    rng = np.random.default_rng(7)
    logits = rng.normal(0, 1, (3, 20, classes)).astype(np.float32)
    # Sample 0 spells 16.30 with repeats and blanks between letters.
    for t, c in enumerate([0, 2, 2, 0, 7, 0, 11, 11, 0, 4, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0]):
        logits[0, t, c] += 8.0
    # Sample 1 is all blank.
    logits[1, :, 0] += 8.0
    probs = np.exp(logits) / np.exp(logits).sum(axis=2, keepdims=True)
    lines, _ = decode(probs)
    case = {
        "chars": chars, "dims": list(probs.shape),
        "probs": [round(float(v), 6) for v in probs.flatten()],
        "expected": [[text, float(score)] for text, score in lines],
    }
    with open(os.path.join(OUT, "ctc.json"), "w", encoding="utf-8") as f:
        json.dump(case, f)
    print("ctc:", case["expected"])


os.makedirs(OUT, exist_ok=True)
det_case("mixed", 128, 64, 192, 96, [
    (30, 16, 40, 10, 0, 0.8),    # upright line
    (90, 40, 36, 10, 25, 0.7),   # turned 25 degrees
    (20, 50, 1, 1, 0, 0.9),      # a single pixel: dropped (shorter side under 3)
    (100, 12, 30, 8, 0, 0.4),    # above thresh, below box_thresh: dropped
])
det_case("vertical", 64, 128, 64, 128, [
    (32, 64, 8, 50, 0, 0.85),    # a vertical value
])
ctc_case()
