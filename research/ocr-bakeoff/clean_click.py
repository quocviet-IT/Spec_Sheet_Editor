"""Click crops with the straight dimension/extension lines painted out before OCR.

Same 64x64 window and same imprecise click as prep.py; any horizontal or vertical run of
non-white pixels longer than a glyph (11 px) is painted white, then upscale x4 and rotate.
"""
import json, os
from PIL import Image

HALF, RUN, Z = 32, 11, 4
ANGLES = [0, 90, -90, 60, -60]
truth = json.load(open("truth.json"))["truth"]
page = Image.open(os.environ.get("SAMPLE", os.path.join("..", "..", "samples", "sample.png"))).convert("RGB")
os.makedirs("clean", exist_ok=True)

for g in truth:
    cx, cy = g["x"] + 3, g["y"] + 2
    win = page.crop((cx - HALF, cy - HALF, cx + HALF, cy + HALF))
    W, H = win.size
    px = win.load()
    ink = lambda x, y: (0.299 * px[x, y][0] + 0.587 * px[x, y][1] + 0.114 * px[x, y][2]) < 235
    kill = set()
    for y in range(H):
        x = 0
        while x < W:
            if ink(x, y):
                s = x
                while x < W and ink(x, y): x += 1
                if x - s >= RUN: kill.update((i, y) for i in range(s, x))
            else: x += 1
    for x in range(W):
        y = 0
        while y < H:
            if ink(x, y):
                s = y
                while y < H and ink(x, y): y += 1
                if y - s >= RUN: kill.update((x, i) for i in range(s, y))
            else: y += 1
    for (x, y) in kill:
        px[x, y] = (255, 255, 255)
    big = win.resize((W * Z, H * Z), Image.LANCZOS)
    for a in ANGLES:
        big.rotate(a, expand=True, fillcolor="white", resample=Image.BICUBIC).save(f"clean/{g['key']}__{a}.png")
print(len(os.listdir("clean")), "files")
