"""One summary row per results file: located/read on the scan, read on click, timings."""
import json, re, sys

NUM = re.compile(r"^\d{1,2}\.\d{2}$")
truth = json.load(open("truth.json"))
fx0, fy0, _, _ = truth["frame"]
S = truth["scale_scan"]
fw, fh = truth["frame_size"]
W, H = fw * S, fh * S
ANGLES = {"0", "90", "-90", "60", "-60"}  # same click angles for every engine


def norm(t):
    t = re.sub(r"[^0-9.]", "", t.replace(",", "."))
    if re.fullmatch(r"\d{3,4}", t):
        t = t[:-2] + "." + t[-2:]
    return t


def to_page(view, x, y):
    if view == "cw":
        x, y = y, H - 1 - x
    elif view == "ccw":
        x, y = W - 1 - y, x
    return fx0 + x / S, fy0 + y / S


def summary(path):
    res = json.load(open(path))
    dets = []
    for view, ws in res["scan"].items():
        if view == "ccw":
            continue  # the design scans 0° and 90° CW only
        for w in ws:
            t = norm(w["text"])
            if NUM.match(t):
                b = w["box"]
                dets.append((t, *to_page(view, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2)))
    near = lambda d, g: abs(d[1] - g["x"]) <= 20 and abs(d[2] - g["y"]) <= 20
    located = sum(any(near(d, g) for d in dets) for g in truth["truth"])
    read = sum(any(near(d, g) and d[0] == g["value"] for d in dets) for g in truth["truth"])
    stray = sum(not any(near(d, g) for g in truth["truth"]) for d in dets)
    click_ok, wrong = 0, []
    for g in truth["truth"]:
        best = None
        for f, ws in res["click"].items():
            key, ang = f[:-4].split("__")
            if key != g["key"] or ang not in ANGLES:
                continue
            for w in ws:
                t = norm(w["text"])
                if NUM.match(t) and (best is None or w["conf"] > best[1]):
                    best = (t, w["conf"])
        if best and best[0] == g["value"]:
            click_ok += 1
        else:
            wrong.append(f"{g['key']}:{best[0] if best else '-'}")
    return located, read, stray, click_ok, wrong, res.get("ms", {})


for p in sys.argv[1:]:
    loc, rd, st, ck, wr, ms = summary(p)
    print(f"{p:28} scan: located {loc}/11 read {rd}/11 stray {st} | click: {ck}/11 wrong {wr} | ms {ms}")
