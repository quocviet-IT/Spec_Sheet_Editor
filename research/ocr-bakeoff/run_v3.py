"""RapidOCR 3.x with a chosen PaddleOCR generation/size -> results_<cfg>.json (same shape as run_rapid.py).

usage: run_v3.py <cfg> [srcdir_for_scan] [clickdir]
cfg: v4_mobile v4_server v5_mobile v5_server v6_small v6_medium
"""
import json, os, sys, time
from rapidocr import RapidOCR, OCRVersion, ModelType, LangDet, LangRec

CFGS = {
    "v4_mobile": (OCRVersion.PPOCRV4, ModelType.MOBILE, LangDet.CH, LangRec.CH),
    "v4_server": (OCRVersion.PPOCRV4, ModelType.SERVER, LangDet.CH, LangRec.CH),
    "v5_mobile": (OCRVersion.PPOCRV5, ModelType.MOBILE, LangDet.CH, LangRec.CH),
    "v5_server": (OCRVersion.PPOCRV5, ModelType.SERVER, LangDet.CH, LangRec.CH),
    "v6_small": (OCRVersion.PPOCRV6, ModelType.SMALL, LangDet.CH, LangRec.CH),
    "v6_medium": (OCRVersion.PPOCRV6, ModelType.MEDIUM, LangDet.CH, LangRec.CH),
}
name = sys.argv[1]
SCAN = sys.argv[2] if len(sys.argv) > 2 else "scan"
CLICK = sys.argv[3] if len(sys.argv) > 3 else "click"
ver, size, ldet, lrec = CFGS[name]
rec_lang = lrec
engine = RapidOCR(params={
    "Global.log_level": "error",
    "Det.ocr_version": ver, "Det.model_type": size, "Det.lang_type": ldet,
    "Rec.ocr_version": ver, "Rec.model_type": size, "Rec.lang_type": rec_lang,
})


def words(path):
    r = engine(path)
    out = []
    if r is None or r.boxes is None or r.txts is None:
        return out
    for poly, text, conf in zip(r.boxes, r.txts, r.scores):
        xs = [float(p[0]) for p in poly]; ys = [float(p[1]) for p in poly]
        out.append({"text": text, "conf": float(conf) * 100, "box": [min(xs), min(ys), max(xs), max(ys)]})
    return out


out = {"scan": {}, "click": {}}
t0 = time.time()
for v in ["r0", "cw"]:  # the design scans 0 deg and 90 deg clockwise only
    out["scan"][v] = words(os.path.join(SCAN, v + ".png"))
t_scan = time.time() - t0
files = sorted(f for f in os.listdir(CLICK) if not f.endswith(("__30.png", "__-30.png")))
t1 = time.time()
for f in files:
    out["click"][f] = words(os.path.join(CLICK, f))
out["ms"] = {"scan": round(t_scan * 1000), "click_per_image": round((time.time() - t1) * 1000 / len(files))}
json.dump(out, open(f"results_{name}.json", "w"), indent=1)
print(name, "done", out["ms"])
