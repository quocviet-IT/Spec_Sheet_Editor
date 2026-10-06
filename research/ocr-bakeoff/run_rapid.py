"""RapidOCR (PaddleOCR detection + recognition models on ONNX) -> results_rapid.json"""
import json, os, sys, time
CLICK = sys.argv[1] if len(sys.argv) > 1 else "click"
OUT = sys.argv[2] if len(sys.argv) > 2 else "results_rapid.json"
SKIP_SCAN = len(sys.argv) > 3
from rapidocr_onnxruntime import RapidOCR

engine = RapidOCR()


def words(path):
    res, _ = engine(path)
    out = []
    for poly, text, conf in res or []:
        xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
        out.append({"text": text, "conf": float(conf) * 100, "box": [min(xs), min(ys), max(xs), max(ys)]})
    return out


out = {"scan": {}, "click": {}}
t0 = time.time()
for v in ([] if SKIP_SCAN else ["r0", "cw", "ccw"]):
    out["scan"][v] = words(os.path.join("scan", v + ".png"))
t_scan = time.time() - t0
t1 = time.time()
files = sorted(os.listdir(CLICK))
for f in files:
    out["click"][f] = words(os.path.join(CLICK, f))
out["ms"] = {"scan": round(t_scan * 1000), "click_per_image": round((time.time() - t1) * 1000 / len(files))}
json.dump(out, open(OUT, "w"), indent=1)
print("done", out["ms"])
