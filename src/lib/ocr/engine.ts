import * as ort from "onnxruntime-web/wasm";
import { buildAlphabet } from "./alphabet";
import type { OcrModels, Tensor } from "./pipeline";
import type { InitOptions, InitResult, ModelInput } from "./protocol";

export type LoadedModels = OcrModels & { release(): Promise<void> };

async function bytesOf(input: ModelInput): Promise<ArrayBuffer> {
  if (typeof input !== "string") return input;
  const response = await fetch(input);
  if (!response.ok) throw new Error(`Model download failed: ${input} (HTTP ${response.status})`);
  return response.arrayBuffer();
}

async function run(session: ort.InferenceSession, input: Tensor): Promise<Tensor> {
  const feed = new ort.Tensor("float32", input.data, [...input.dims]);
  const outputs = await session.run({ [session.inputNames[0]]: feed });
  const output = outputs[session.outputNames[0]];
  return { data: output.data as Float32Array, dims: output.dims };
}

/**
 * The runtime's JavaScript is loaded from a Blob URL: its thread workers start from that same URL, and
 * a Worker could not start a nested Worker from a network URL in the browser this was tested in.
 */
async function runtimePaths(prefix: string): Promise<{ mjs: string; wasm: string }> {
  const glue = await fetch(`${prefix}ort-wasm-simd-threaded.mjs`);
  if (!glue.ok) throw new Error(`OCR runtime download failed: ${prefix}ort-wasm-simd-threaded.mjs (HTTP ${glue.status})`);
  const mjs = URL.createObjectURL(new Blob([await glue.text()], { type: "text/javascript" }));
  return { mjs, wasm: `${prefix}ort-wasm-simd-threaded.wasm` };
}

/** Runs inside the Worker only (uses self.crossOriginIsolated and navigator). */
export async function loadModels(options: InitOptions): Promise<{ models: LoadedModels; info: InitResult }> {
  const isolated = self.crossOriginIsolated === true;
  const numThreads =
    options.numThreads ?? (isolated ? Math.max(1, Math.min(4, Math.floor(navigator.hardwareConcurrency / 2))) : 1);
  ort.env.wasm.wasmPaths = await runtimePaths(options.wasmPaths);
  ort.env.wasm.numThreads = numThreads;

  const started = performance.now();
  const [det, rec, keys] = await Promise.all([bytesOf(options.det), bytesOf(options.rec), bytesOf(options.keys)]);
  const sessionOptions: ort.InferenceSession.SessionOptions = {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  };
  const detSession = await ort.InferenceSession.create(new Uint8Array(det), sessionOptions);
  const recSession = await ort.InferenceSession.create(new Uint8Array(rec), sessionOptions);
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
  await models.detect({ data: new Float32Array(3 * 32 * 32), dims: [1, 3, 32, 32] });
  const probe = await models.recognize({ data: new Float32Array(3 * 48 * 320), dims: [1, 3, 48, 320] });
  if (probe.dims[2] !== chars.length) {
    await models.release();
    throw new Error(`The recognition model has ${probe.dims[2]} classes but the keys file gives ${chars.length}.`);
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
