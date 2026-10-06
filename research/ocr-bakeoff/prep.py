"""Prepare identical inputs for every OCR engine.

scan/  : whole drawing frame, upscaled x3, at 0 / 90 CW / 90 CCW  (engine must find numbers itself)
click/ : 64x64 px around each known number (a simulated click), upscaled x4, at several angles
truth.json : the 11 numbers and their centres on the page (read by eye from the sample)
"""
import json, os
from PIL import Image

SRC = os.environ.get("SAMPLE", os.path.join("..", "..", "samples", "sample.png"))
FRAME = (52, 116, 760, 654)
SCALE_SCAN = 3
SCALE_CLICK = 4
HALF = 32
CLICK_ANGLES = [0, 90, -90, 30, -30, 60, -60]

TRUTH = [
    ("1.20", "1.20", 265, 134, "diag"),
    ("2.50a", "2.50", 328, 189, "vert"),
    ("6.90", "6.90", 147, 457, "vert"),
    ("16.30", "16.30", 230, 536, "horiz"),
    ("1.50", "1.50", 153, 605, "vert"),
    ("1.70", "1.70", 296, 610, "horiz"),
    ("1.80", "1.80", 538, 465, "horiz"),
    ("10.29", "10.29", 650, 451, "horiz"),
    ("7.05", "7.05", 703, 493, "vert"),
    ("4.66", "4.66", 702, 575, "vert"),
    ("2.50b", "2.50", 569, 627, "horiz"),
]

os.makedirs("scan", exist_ok=True)
os.makedirs("click", exist_ok=True)
page = Image.open(SRC).convert("RGB")

frame = page.crop(FRAME)
big = frame.resize((frame.width * SCALE_SCAN, frame.height * SCALE_SCAN), Image.LANCZOS)
big.save("scan/r0.png")
big.rotate(-90, expand=True).save("scan/cw.png")   # bottom-to-top text becomes horizontal
big.rotate(90, expand=True).save("scan/ccw.png")

# simulate an imprecise click: 3 px right, 2 px down of the true centre
for key, value, x, y, orient in TRUTH:
    cx, cy = x + 3, y + 2
    crop = page.crop((cx - HALF, cy - HALF, cx + HALF, cy + HALF))
    crop = crop.resize((crop.width * SCALE_CLICK, crop.height * SCALE_CLICK), Image.LANCZOS)
    for a in CLICK_ANGLES:
        crop.rotate(a, expand=True, fillcolor="white", resample=Image.BICUBIC).save(f"click/{key}__{a}.png")

json.dump({
    "frame": FRAME, "scale_scan": SCALE_SCAN, "frame_size": [frame.width, frame.height],
    "truth": [dict(key=k, value=v, x=x, y=y, orient=o) for k, v, x, y, o in TRUTH],
}, open("truth.json", "w"), indent=1)
print("scan:", sorted(os.listdir("scan")), "click files:", len(os.listdir("click")))
