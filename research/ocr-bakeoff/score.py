"""Score an engine's results against truth.json.

scan : a number counts as found when a detection with exactly its value has its centre
       within 20 px (page pixels) of the true centre. Other number-shaped detections
       anywhere in the frame count as false alarms.
click: per number, take the best number-shaped reading across all tried angles
       (highest confidence); correct when it equals the true value.
"""
import json, re, sys

NUM = re.compile(r"^\d{1,2}\.\d{2}$")
truth = json.load(open("truth.json"))
res = json.load(open(sys.argv[1]))
RULE = len(sys.argv) > 2  # every dimension on this form has two decimals: "1630" -> "16.30"
fx0, fy0, _, _ = truth["frame"]
S = truth["scale_scan"]
fw, fh = truth["frame_size"]
W, H = fw * S, fh * S  # size of the unrotated upscaled frame


def norm(t):
    t = re.sub(r"[^0-9.]", "", t.replace(",", "."))
    if RULE and re.fullmatch(r"\d{3,4}", t):
        t = t[:-2] + "." + t[-2:]
    return t


def to_page(view, x, y):
    if view == "cw":    # rotate(-90): (x,y) -> (H-1-y, x)  => inverse
        x, y = y, H - 1 - x
    elif view == "ccw":  # rotate(90): (x,y) -> (y, W-1-x)  => inverse
        x, y = W - 1 - y, x
    return fx0 + x / S, fy0 + y / S


dets = []
for view, ws in res["scan"].items():
    for w in ws:
        t = norm(w["text"])
        if not NUM.match(t):
            continue
        b = w["box"]
        px, py = to_page(view, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
        dets.append((t, px, py, view, round(w["conf"])))

found, used = [], set()
for g in truth["truth"]:
    hit = None
    for i, (t, px, py, view, conf) in enumerate(dets):
        if t == g["value"] and abs(px - g["x"]) <= 20 and abs(py - g["y"]) <= 20:
            hit = (i, view, conf); break
    if hit:
        used.add(hit[0])
    found.append((g["key"], g["orient"], hit is not None, hit[1] if hit else "-"))
false_alarms = [d for i, d in enumerate(dets) if i not in used and not any(
    d[0] == g["value"] and abs(d[1] - g["x"]) <= 20 and abs(d[2] - g["y"]) <= 20 for g in truth["truth"])]

print("== SCAN THE WHOLE DRAWING ==")
for k, o, ok, v in found:
    print(f"  {k:6} {o:5} {'ok  ' if ok else 'miss'} {v}")
located = sum(1 for g in truth["truth"] if any(abs(d[1] - g["x"]) <= 20 and abs(d[2] - g["y"]) <= 20 for d in dets))
stray = sum(1 for d in dets if not any(abs(d[1] - g["x"]) <= 20 and abs(d[2] - g["y"]) <= 20 for g in truth["truth"]))
print(f"  found {sum(1 for f in found if f[2])}/11, located {located}/11, stray numbers {stray}: {[d[0] for d in false_alarms][:15]}")

print("== CLICK EACH NUMBER ==")
ok_n = 0
for g in truth["truth"]:
    best = None
    for f, ws in res["click"].items():
        key, ang = f[:-4].split("__")
        if key != g["key"]:
            continue
        for w in ws:
            t = norm(w["text"])
            if NUM.match(t) and (best is None or w["conf"] > best[1]):
                best = (t, w["conf"], ang)
    ok = best is not None and best[0] == g["value"]
    ok_n += ok
    print(f"  {g['key']:6} {g['orient']:5} -> {best[0] if best else '(nothing read)':16} {'ok   ' if ok else 'WRONG'} {('angle ' + best[2] + ', confidence ' + str(round(best[1]))) if best else ''}")
print(f"  read correctly {ok_n}/11")
print("time (ms):", res.get("ms"))
