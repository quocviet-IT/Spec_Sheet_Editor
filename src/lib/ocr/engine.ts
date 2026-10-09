import * as ort from "onnxruntime-web/wasm";
import { buildAlphabet } from "./alphabet";
import type { OcrModels, Tensor } from "./pipeline";
import { OcrFailure, type InitOptions, type InitResult, type ModelInput } from "./protocol";

export type LoadedModels = OcrModels & { release(): Promise<void> };

async function bytesOf(input: ModelInput): Promise<ArrayBuffer> {
  if (typeof input !== "string") return input;
  const failed = (why: string) => new OcrFailure("model_download", `Model download failed: ${input} (${why})`);
  let response: Response;
  try {
    response = await fetch(input);
  } catch (error) {
    throw failed(error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) throw failed(`HTTP ${response.status}`);
  try {
    return await response.arrayBuffer();
  } catch (error) {
    throw failed(error instanceof Error ? error.message : String(error));
  }
}

function asInitFailure(error: unknown): OcrFailure {
  if (error instanceof OcrFailure) return error;
  return new OcrFailure("init_failed", error instanceof Error ? error.message : String(error));
}

async function run(session: ort.InferenceSession, input: Tensor): Promise<Tensor> {
  const feed = new ort.Tensor("float32", input.data, [...input.dims]);
  const outputs = await session.run({ [session.inputNames[0]]: feed });
  const output = outputs[session.outputNames[0]];
  return { data: output.data as Float32Array, dims: output.dims };
}

/** One file of the runtime, or a `runtime_download` failure that names it. */
async function runtimeFile(url: string): Promise<Response> {
  const failed = (why: string) => new OcrFailure("runtime_download", `OCR runtime download failed: ${url} (${why})`);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw failed(error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) throw failed(`HTTP ${response.status}`);
  return response;
}

/**
 * The runtime's JavaScript is loaded from a Blob URL: its thread workers start from that same URL, and
 * a Worker could not start a nested Worker from a network URL in the browser this was tested in. The
 * WebAssembly file is downloaded here too and handed over as bytes, so a failed download reads as one
 * and not as "the browser cannot run the reader".
 */
async function runtimePaths(prefix: string): Promise<{ mjs: string; wasm: ArrayBuffer }> {
  const [glue, binary] = await Promise.all([runtimeFile(`${prefix}ort-wasm-simd-threaded.mjs`), runtimeFile(`${prefix}ort-wasm-simd-threaded.wasm`)]);
  let text: string;
  let wasm: ArrayBuffer;
  try {
    [text, wasm] = await Promise.all([glue.text(), binary.arrayBuffer()]);
  } catch (error) {
    throw new OcrFailure("runtime_download", `OCR runtime download failed: ${prefix} (${error instanceof Error ? error.message : String(error)})`);
  }
  return { mjs: URL.createObjectURL(new Blob([text], { type: "text/javascript" })), wasm };
}

/** onnxruntime initialises its runtime once per Worker, so the Blob URL is made once too. */
let runtime: Promise<{ mjs: string; wasm: ArrayBuffer }> | null = null;

/** Runs inside the Worker only (uses self.crossOriginIsolated and navigator). */
export async function loadModels(options: InitOptions): Promise<{ models: LoadedModels; info: InitResult }> {
  const isolated = self.crossOriginIsolated === true;
  const numThreads =
    options.numThreads ?? (isolated ? Math.max(1, Math.min(4, Math.floor(navigator.hardwareConcurrency / 2))) : 1);
  runtime ??= runtimePaths(options.wasmPaths).catch((error: unknown) => {
    runtime = null; // a failed download may be retried
    throw error;
  });
  const files = await runtime;
  ort.env.wasm.wasmPaths = { mjs: files.mjs };
  ort.env.wasm.wasmBinary = new Uint8Array(files.wasm);
  ort.env.wasm.numThreads = numThreads;

  const started = performance.now();
  const [det, rec, keys] = await Promise.all([bytesOf(options.det), bytesOf(options.rec), bytesOf(options.keys)]);
  const sessionOptions: ort.InferenceSession.SessionOptions = {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  };
  let detSession: ort.InferenceSession;
  try {
    detSession = await ort.InferenceSession.create(new Uint8Array(det), sessionOptions);
  } catch (error) {
    throw asInitFailure(error);
  }
  let recSession: ort.InferenceSession;
  try {
    recSession = await ort.InferenceSession.create(new Uint8Array(rec), sessionOptions);
  } catch (error) {
    await detSession.release();
    throw asInitFailure(error);
  }
  const chars = buildAlphabet(new TextDecoder().decode(keys));
  const loaded = performance.now();

  const models: LoadedModels = {
    chars,
    detect: (input) => run(detSession, input),
    recognize: (input) => run(recSession, input),
    release: async () => {
      await detSession.release();
      await recSession.release();
    },
  };

  // The first run compiles kernels; the probe also proves the alphabet belongs to this model.
  try {
    await models.detect({ data: new Float32Array(3 * 32 * 32), dims: [1, 3, 32, 32] });
    const probe = await models.recognize({ data: new Float32Array(3 * 48 * 320), dims: [1, 3, 48, 320] });
    if (probe.dims[2] !== chars.length) {
      throw new Error(`The recognition model has ${probe.dims[2]} classes but the keys file gives ${chars.length}.`);
    }
  } catch (error) {
    await models.release();
    throw asInitFailure(error);
  }

  return {
    models,
    info: {
      numThreads,
      crossOriginIsolated: isolated,
      classes: chars.length,
      loadMs: loaded - started,
      warmupMs: performance.now() - loaded,
    },
  };
}
