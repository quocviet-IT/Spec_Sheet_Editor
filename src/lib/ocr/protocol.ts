import type { ReadResult } from "./click";
import type { Point, Rect } from "./geometry";
import type { Raster } from "./raster";
import type { ScanResult } from "./scan";

export type { ReadResult, ScanResult };

/** A model file: a URL to fetch, or bytes the page already holds (a model picked from disk on the bench). */
export type ModelInput = string | ArrayBuffer;

export type InitOptions = {
  det: ModelInput;
  rec: ModelInput;
  keys: ModelInput;
  /** Where ort-wasm-simd-threaded.mjs / .wasm are served. */
  wasmPaths: string;
  /** Defaults to half the cores (at most 4) when the page is cross-origin isolated, else 1. */
  numThreads?: number;
};

export type InitResult = {
  numThreads: number;
  crossOriginIsolated: boolean;
  classes: number;
  loadMs: number;
  warmupMs: number;
};

export type OcrRequest =
  | { id: number; type: "init"; options: InitOptions }
  | { id: number; type: "setPage"; page: Raster }
  | { id: number; type: "scan"; area: Rect; targetWidth?: number }
  | { id: number; type: "read"; point: Point }
  | { id: number; type: "release" };

export type OcrResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
