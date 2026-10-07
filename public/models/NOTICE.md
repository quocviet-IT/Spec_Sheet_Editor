# Models

`ppocr-v4/det.onnx` and `ppocr-v4/rec.onnx` are the PP-OCRv4 mobile text detection and recognition
models from PaddleOCR (PaddlePaddle), as converted to ONNX and published by RapidOCR (RapidAI),
release 3.9.2:

- https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv4/det/ch_PP-OCRv4_det_mobile.onnx
  (SHA-256 d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9)
- https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv4/rec/ch_PP-OCRv4_rec_mobile.onnx
  (SHA-256 48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b)

`ppocr-v4/keys.txt` is the recognition model's alphabet, read from the model's own metadata with
`research/ocr-models/extract_keys.py` (6,623 entries).

Both models are licensed under the Apache License, Version 2.0
(https://www.apache.org/licenses/LICENSE-2.0). They are redistributed unchanged.
