"""Write a PaddleOCR recognition model's alphabet (ONNX metadata "character") to a keys file.

usage: python extract_keys.py <rec.onnx> <keys.txt>
Needs: pip install onnxruntime
"""
import sys

import onnxruntime as ort

model, out = sys.argv[1], sys.argv[2]
session = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
meta = session.get_modelmeta().custom_metadata_map
if "character" not in meta:
    sys.exit(f"{model} has no 'character' metadata; is it a recognition model?")
chars = meta["character"]
with open(out, "w", encoding="utf-8", newline="\n") as f:
    f.write(chars if chars.endswith("\n") else chars + "\n")
output = session.get_outputs()[0]
print(f"{len(chars.splitlines())} characters; output {output.name} {output.shape}")
