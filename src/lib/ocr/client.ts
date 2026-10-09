import type { Point, Rect } from "./geometry";
import { OcrFailure, type InitOptions, type InitResult, type OcrRequest, type OcrResponse, type ReadResult, type ScanResult } from "./protocol";
import type { Raster } from "./raster";

export const OCR_WORKER_URL = "/ocr/ocr-worker.js";
export const ORT_WASM_PATH = "/ocr/ort/";
export const DEFAULT_MODELS = {
  det: "/models/ppocr-v4/det.onnx",
  rec: "/models/ppocr-v4/rec.onnx",
  keys: "/models/ppocr-v4/keys.txt",
} as const;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Pending = { resolve: (value: unknown) => void; reject: (error: OcrFailure) => void };

/** Main-thread handle on the OCR Worker: one promise per request, answered in order. */
export class OcrClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  /** Set once the Worker failed or was stopped; every later request rejects with it. */
  private failure: OcrFailure | null = null;

  private fail(error: OcrFailure): void {
    this.failure ??= error;
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }

  constructor(url: string = OCR_WORKER_URL) {
    this.worker = new Worker(url, { type: "module" });
    this.worker.onmessage = (event: MessageEvent<OcrResponse>) => {
      const response = event.data;
      const waiting = this.pending.get(response.id);
      if (!waiting) return;
      this.pending.delete(response.id);
      if (response.ok) waiting.resolve(response.result);
      else waiting.reject(new OcrFailure(response.code ?? "failed", response.error));
    };
    this.worker.onerror = (event) => this.fail(new OcrFailure("failed", event.message || "The OCR worker stopped."));
    this.worker.onmessageerror = () => this.fail(new OcrFailure("failed", "The OCR worker sent a message that could not be read."));
  }

  protected call<T>(request: DistributiveOmit<OcrRequest, "id">, transfer: Transferable[] = []): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      try {
        this.worker.postMessage({ ...request, id }, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(new OcrFailure("failed", error instanceof Error ? error.message : String(error)));
      }
    });
  }

  /** Model bytes passed as ArrayBuffers are transferred to the Worker (the caller's copies become empty). */
  init(options: Omit<InitOptions, "wasmPaths"> & { wasmPaths?: string }): Promise<InitResult> {
    const full: InitOptions = { wasmPaths: ORT_WASM_PATH, ...options };
    const transfer = [full.det, full.rec, full.keys].filter((m): m is ArrayBuffer => typeof m !== "string");
    return this.call<InitResult>({ type: "init", options: full }, transfer);
  }

  /** The Worker gets its own copy, so the caller's pixels stay usable. */
  setPage(page: Raster): Promise<void> {
    const data = new Uint8ClampedArray(page.data);
    return this.call<void>({ type: "setPage", page: { width: page.width, height: page.height, data } }, [data.buffer]);
  }

  scan(area: Rect, targetWidth?: number): Promise<ScanResult> {
    return this.call<ScanResult>({ type: "scan", area, targetWidth });
  }

  read(point: Point): Promise<ReadResult> {
    return this.call<ReadResult>({ type: "read", point });
  }

  /**
   * Stops the Worker at once, even in the middle of a scan; pending requests reject. After a failed init,
   * start a new OcrClient: onnxruntime cannot initialise its runtime twice in one Worker.
   */
  dispose(): void {
    this.worker.terminate();
    this.fail(new OcrFailure("failed", "The OCR worker was stopped."));
  }
}
