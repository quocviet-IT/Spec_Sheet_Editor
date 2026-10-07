import type { InitOptions, InitResult, OcrRequest, OcrResponse } from "./protocol";

export const OCR_WORKER_URL = "/ocr/ocr-worker.js";
export const ORT_WASM_PATH = "/ocr/ort/";
export const DEFAULT_MODELS = {
  det: "/models/ppocr-v4/det.onnx",
  rec: "/models/ppocr-v4/rec.onnx",
  keys: "/models/ppocr-v4/keys.txt",
} as const;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/** Main-thread handle on the OCR Worker: one promise per request, answered in order. */
export class OcrClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(url: string = OCR_WORKER_URL) {
    this.worker = new Worker(url, { type: "module" });
    this.worker.onmessage = (event: MessageEvent<OcrResponse>) => {
      const response = event.data;
      const waiting = this.pending.get(response.id);
      if (!waiting) return;
      this.pending.delete(response.id);
      if (response.ok) waiting.resolve(response.result);
      else waiting.reject(new Error(response.error));
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "The OCR worker could not start.");
      for (const waiting of this.pending.values()) waiting.reject(error);
      this.pending.clear();
    };
  }

  protected call<T>(request: DistributiveOmit<OcrRequest, "id">, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ ...request, id }, transfer);
    });
  }

  /** Model bytes passed as ArrayBuffers are transferred to the Worker (the caller's copies become empty). */
  init(options: Omit<InitOptions, "wasmPaths"> & { wasmPaths?: string }): Promise<InitResult> {
    const full: InitOptions = { wasmPaths: ORT_WASM_PATH, ...options };
    const transfer = [full.det, full.rec, full.keys].filter((m): m is ArrayBuffer => typeof m !== "string");
    return this.call<InitResult>({ type: "init", options: full }, transfer);
  }

  async dispose(): Promise<void> {
    try {
      await this.call({ type: "release" });
    } finally {
      this.worker.terminate();
    }
  }
}
