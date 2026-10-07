# M2 Browser OCR Implementation Plan

> Work through the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PaddleOCR PP-OCRv4 small running in a Web Worker in the browser: scan the drawing area at
0° and 90° clockwise, read a value around a click, and a developer bench page that scores the
11-value sample sheet against the TC-20 / TC-24 targets, so the model choice is settled on a real
office PC before the editor (M4) is built.

**Architecture:** Pure TypeScript ports of RapidOCR 3.9.2's pre- and post-processing (`src/lib/ocr/*`,
no canvas, so the same code runs in Vitest and in the Worker) around two ONNX sessions from
onnxruntime-web 1.30 (WebAssembly, multi-threaded when the page is cross-origin isolated). The Worker
is bundled by esbuild into `public/ocr/` (Turbopack copies `new Worker(new URL(...))` targets without
bundling them), and the onnxruntime runtime files are copied next to it. The page talks to the Worker
through a small promise-based client. Algorithms are checked against RapidOCR's own Python classes on
synthetic inputs.

**Tech Stack:** Next.js 16.3.8, React 19.2, TypeScript 5, onnxruntime-web 1.30.0 (`/wasm` entry,
external WASM), esbuild 0.28.2, Vitest 4. Python 3 + RapidOCR 3.9.2 only to regenerate parity
fixtures (never at runtime).

**Spec:** [`docs/design/spec-sheet-editor-design.md`](../design/spec-sheet-editor-design.md) — UC-04
steps 3–4, UC-06, NFR-01, section 7.3, TC-20, TC-22, TC-24. Roadmap:
[`2026-10-07-spec-sheet-editor-roadmap.md`](2026-10-07-spec-sheet-editor-roadmap.md), milestone M2.

## Global Constraints

- Repo is **public**: never commit `.env.local`, real sheets, SO/MO numbers or keys. Stage files one by one.
- File names, commit messages and documents are in English. The only Vietnamese text in the repository is interface copy: the dictionary `src/messages/vi.ts` and the language's own name ("Tiếng Việt") on the VI/EN switch. Model data files (`public/models/**/keys.txt`, the recogniser's alphabet) are data, not text.
- Commits carry no attribution trailer of any kind (no Co-Authored-By, no tool or AI mentions).
- Code, identifiers and comments in English.
- OCR runs only in the browser, in one Web Worker; no image or reading is sent to the server.
- Models: PP-OCRv4 mobile ("v4 small") from RapidOCR 3.9.2 (ModelScope), committed under `public/models/ppocr-v4/` with these SHA-256 values: `det.onnx` d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9, `rec.onnx` 48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b, `keys.txt` a1c84d9bdb9ab29043c58896224d32941783eb821629618416dcb08f12886492 (6,623 lines; the model has 6,625 classes = blank + 6,623 + space). Licence Apache-2.0, noted in `public/models/NOTICE.md`. Do not run the large server/medium models on the office PC.
- `onnxruntime-web` pinned to `1.30.0`, `esbuild` to `0.28.2`. Code imports `onnxruntime-web/wasm`; the Worker bundle resolves it to `dist/ort.wasm.min.mjs` (the build without an inlined runtime), so the runtime loads `ort-wasm-simd-threaded.mjs` / `.wasm` from `/ocr/ort/` and its thread workers start from that file.
- Every page is cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`) so onnxruntime can use threads.
- Real sheets never enter the repository. The bench reads the sample from `samples/sample.png` (git-ignored) or a file picker; only results are written to the docs. Parity fixtures are synthetic.
- Developer pages live under `/dev/*`: they are tools, not user-facing (English text, no dictionary entries), and return 404 in production unless `ENABLE_DEV_PAGES=1`.
- Every user-facing string still comes from `src/messages/vi.ts` + `src/messages/en.ts` (none are added in M2).
- Every data-bearing page, server action and route handler calls `requireUser()` / `requireAdmin()` itself (M2 adds none: the bench and its sample route serve no stored data).

## File structure

| File | Responsibility |
|---|---|
| `scripts/build-ocr-worker.mts` | Bundles the Worker into `public/ocr/ocr-worker.js` and copies the onnxruntime runtime to `public/ocr/ort/` |
| `public/models/ppocr-v4/{det.onnx,rec.onnx,keys.txt}`, `public/models/NOTICE.md` | Models, alphabet, licence note |
| `research/ocr-models/extract_keys.py` | Reads a recognition model's alphabet from its ONNX metadata (to try other models on the bench) |
| `research/ocr-parity/make_fixtures.py`, `README.md` | Regenerates the parity fixtures with RapidOCR's own classes |
| `src/lib/ocr/geometry.ts` | Points, quads, Python rounding, convex hull, min-area rectangle, box ordering |
| `src/lib/ocr/raster.ts` | RGBA buffers: crop, resize, rotations, straightened quad crop, BGR tensor |
| `src/lib/ocr/alphabet.ts` | Recogniser alphabet from `keys.txt` |
| `src/lib/ocr/det.ts` | Detector input size and DB post-processing |
| `src/lib/ocr/rec.ts` | Recogniser batch tensor and CTC decoding |
| `src/lib/ocr/dimension-text.ts` | Reading → dimension value (TC-22) |
| `src/lib/ocr/pipeline.ts` | `readRegion()`: one image → readings (RapidOCR's pipeline) |
| `src/lib/ocr/scan.ts` | `scanArea()`: UC-04 steps 3–4 |
| `src/lib/ocr/click.ts` | `readAtPoint()`: UC-06 |
| `src/lib/ocr/protocol.ts`, `engine.ts`, `worker.ts`, `client.ts` | Worker messages, onnxruntime sessions, Worker entry, main-thread client |
| `src/lib/ocr/bench/sample.ts`, `score.ts` | Sample truth and TC-20/TC-24 scoring |
| `src/lib/dev-pages.ts` | `devPagesEnabled()` |
| `src/app/dev/ocr-bench/page.tsx`, `bench.tsx`, `sample/route.ts` | The bench |
| `tests/unit/ocr/*.test.ts`, `tests/unit/ocr/fixtures/*.json` | Unit and parity tests |

---

### Task 1: Runtime, models and the Worker round trip

**Files:**
- Modify: `package.json`, `package-lock.json` (dependencies, scripts), `.gitignore`, `eslint.config.mjs`, `next.config.ts`, `src/proxy.ts`
- Create: `.gitattributes`, `scripts/build-ocr-worker.mts`, `public/models/ppocr-v4/det.onnx`, `public/models/ppocr-v4/rec.onnx`, `public/models/ppocr-v4/keys.txt`, `public/models/NOTICE.md`, `research/ocr-models/extract_keys.py`, `src/lib/dev-pages.ts`, `src/lib/ocr/alphabet.ts`, `src/lib/ocr/protocol.ts`, `src/lib/ocr/engine.ts`, `src/lib/ocr/worker.ts`, `src/lib/ocr/client.ts`, `src/app/dev/ocr-bench/page.tsx`, `src/app/dev/ocr-bench/bench.tsx`
- Test: `tests/unit/ocr/alphabet.test.ts`, `tests/unit/dev-pages.test.ts`

**Interfaces:**
- Produces: `buildAlphabet(keys: string): string[]`; `devPagesEnabled(): boolean`; protocol types `ModelInput`, `InitOptions`, `InitResult`, `OcrRequest`, `OcrResponse`; `loadModels(options: InitOptions): Promise<{ models: LoadedModels; info: InitResult }>` where `LoadedModels = { detect(t: Tensor): Promise<Tensor>; recognize(t: Tensor): Promise<Tensor>; chars: readonly string[]; release(): Promise<void> }` and `Tensor = { data: Float32Array; dims: readonly number[] }`; `class OcrClient` with `init()`, `dispose()` (Task 5 adds `setPage`, `scan`, `read`); constants `OCR_WORKER_URL = "/ocr/ocr-worker.js"`, `ORT_WASM_PATH = "/ocr/ort/"`, `DEFAULT_MODELS`; npm script `ocr:build`, run automatically before `dev` and `build`.

- [ ] **Step 1: Dependencies and scripts**

Run: `npm install --save-exact onnxruntime-web@1.30.0` and `npm install --save-dev --save-exact esbuild@0.28.2`

Then add three scripts to `package.json` (keep the existing ones):

```json
    "ocr:build": "tsx scripts/build-ocr-worker.mts",
    "predev": "npm run ocr:build",
    "prebuild": "npm run ocr:build",
```

Append to `.gitignore`:

```gitignore

# OCR Worker bundle and onnxruntime runtime: generated by `npm run ocr:build`
public/ocr/
```

Create `.gitattributes` so Git never rewrites the model files' line endings (their SHA-256 must stay as listed):

```gitattributes
*.onnx binary
public/models/** -text
```

In `eslint.config.mjs`, add `"public/ocr/**"` to the `globalIgnores([...])` list.

- [ ] **Step 2: Models, alphabet and licence note**

Copy the three files (byte for byte) and check their SHA-256 against Global Constraints:

```bash
M=.venv/Lib/site-packages/rapidocr/models  # a RapidOCR 3.9.2 install
K=keys_v4.txt  # python research/ocr-models/extract_keys.py "$M/ch_PP-OCRv4_rec_mobile.onnx" keys_v4.txt
mkdir -p public/models/ppocr-v4
cp "$M/ch_PP-OCRv4_det_mobile.onnx" public/models/ppocr-v4/det.onnx
cp "$M/ch_PP-OCRv4_rec_mobile.onnx" public/models/ppocr-v4/rec.onnx
cp "$K" public/models/ppocr-v4/keys.txt
sha256sum public/models/ppocr-v4/*
```

`public/models/NOTICE.md`:

```markdown
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
```

`research/ocr-models/extract_keys.py`:

```python
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
```

- [ ] **Step 3: Write the failing tests**

`tests/unit/ocr/alphabet.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAlphabet } from "@/lib/ocr/alphabet";

describe("buildAlphabet", () => {
  it("puts the CTC blank first and a space last", () => {
    expect(buildAlphabet("a\nb\n")).toEqual(["blank", "a", "b", " "]);
  });

  it("accepts Windows line endings and a missing final newline", () => {
    expect(buildAlphabet("a\r\nb")).toEqual(["blank", "a", "b", " "]);
  });

  it("gives the v4 model its 6,625 classes", () => {
    const keys = readFileSync(path.join(process.cwd(), "public/models/ppocr-v4/keys.txt"), "utf8");
    const alphabet = buildAlphabet(keys);
    expect(alphabet).toHaveLength(6625);
    for (const c of "0123456789.") expect(alphabet).toContain(c);
  });
});
```

`tests/unit/dev-pages.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { devPagesEnabled } from "@/lib/dev-pages";

afterEach(() => vi.unstubAllEnvs());

describe("devPagesEnabled", () => {
  it("is on outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(devPagesEnabled()).toBe(true);
  });

  it("is off in production unless ENABLE_DEV_PAGES=1", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_DEV_PAGES", "");
    expect(devPagesEnabled()).toBe(false);
    vi.stubEnv("ENABLE_DEV_PAGES", "1");
    expect(devPagesEnabled()).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ocr/alphabet.test.ts tests/unit/dev-pages.test.ts`
Expected: FAIL — cannot resolve `@/lib/ocr/alphabet` and `@/lib/dev-pages`.

- [ ] **Step 5: Implement the pure modules**

`src/lib/ocr/alphabet.ts`:

```ts
/**
 * The recogniser's alphabet: index 0 is the CTC blank and the last entry a space, around the lines of
 * the model's keys file (RapidOCR CTCLabelDecode).
 */
export function buildAlphabet(keys: string): string[] {
  const lines = keys.split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return ["blank", ...lines, " "];
}
```

`src/lib/dev-pages.ts`:

```ts
/** Developer pages (/dev/*) are tools, not features: off in production unless ENABLE_DEV_PAGES=1. */
export function devPagesEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_PAGES === "1";
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ocr/alphabet.test.ts tests/unit/dev-pages.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Worker protocol, engine, Worker entry and client**

`src/lib/ocr/protocol.ts`:

```ts
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
  | { id: number; type: "release" };

export type OcrResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };
```

`src/lib/ocr/engine.ts`:

```ts
import * as ort from "onnxruntime-web/wasm";
import { buildAlphabet } from "./alphabet";
import type { InitOptions, InitResult, ModelInput } from "./protocol";

export type Tensor = { data: Float32Array; dims: readonly number[] };

/** The two models behind the OCR pipeline; the Worker backs this with onnxruntime-web, tests with fakes. */
export type OcrModels = {
  detect(input: Tensor): Promise<Tensor>;
  recognize(input: Tensor): Promise<Tensor>;
  chars: readonly string[];
};

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
```

`src/lib/ocr/worker.ts`:

```ts
import { loadModels, type LoadedModels } from "./engine";
import type { OcrRequest, OcrResponse } from "./protocol";

let models: LoadedModels | null = null;

async function handle(request: OcrRequest): Promise<unknown> {
  switch (request.type) {
    case "init": {
      await models?.release();
      models = null;
      const loaded = await loadModels(request.options);
      models = loaded.models;
      return loaded.info;
    }
    case "release":
      await models?.release();
      models = null;
      return null;
  }
}

// One request at a time: an onnxruntime-web session must not run twice at once.
let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<OcrRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    let response: OcrResponse;
    try {
      response = { id: request.id, ok: true, result: await handle(request) };
    } catch (error) {
      response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    self.postMessage(response);
  });
};
```

`src/lib/ocr/client.ts`:

```ts
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
```

- [ ] **Step 8: Bundle script**

`scripts/build-ocr-worker.mts`:

```ts
/**
 * Bundles the OCR Worker (src/lib/ocr/worker.ts) into public/ocr/ocr-worker.js and copies the
 * onnxruntime-web runtime it loads into public/ocr/ort/. Turbopack copies `new Worker(new URL(...))`
 * targets without bundling them, so the Worker is built here instead; `predev` and `prebuild` run it.
 */
import { build, type Plugin } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "public", "ocr");
const dist = path.join(root, "node_modules", "onnxruntime-web", "dist");
const RUNTIME = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];

/**
 * `onnxruntime-web/wasm` normally resolves to a build with the runtime's JavaScript inlined; its thread
 * workers would then be started from this bundle. Use the build that loads the runtime from
 * ort.env.wasm.wasmPaths instead.
 */
const externalRuntime: Plugin = {
  name: "onnxruntime-external-runtime",
  setup(b) {
    b.onResolve({ filter: /^onnxruntime-web\/wasm$/ }, () => ({ path: path.join(dist, "ort.wasm.min.mjs") }));
  },
};

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "ort"), { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "lib", "ocr", "worker.ts")],
  outfile: path.join(out, "ocr-worker.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  plugins: [externalRuntime],
  logLevel: "warning",
});

for (const file of RUNTIME) await copyFile(path.join(dist, file), path.join(out, "ort", file));

console.log(`OCR worker built: public/ocr/ocr-worker.js, runtime ${RUNTIME.join(", ")}`);
```

Run: `npm run ocr:build`
Expected: the "OCR worker built" line; `public/ocr/ocr-worker.js`, `public/ocr/ort/ort-wasm-simd-threaded.mjs` and `.wasm` exist (`ls -la public/ocr public/ocr/ort`; the `.wasm` is several MB, the Worker bundle far smaller). If `node_modules/onnxruntime-web/dist/ort.wasm.min.mjs` or either runtime file does not exist, stop and report the actual file names in that folder.

- [ ] **Step 9: Isolation headers, model caching, proxy matcher**

`next.config.ts` — replace the file with:

```ts
import type { NextConfig } from "next";

/** Sent on every response. A nonce-based script CSP is added in M7 hardening. */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/** Cross-origin isolation lets onnxruntime-web run the OCR models on several threads (SharedArrayBuffer). */
const isolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
];

const nextConfig: NextConfig = {
  // `next dev` would otherwise write instruction files (AGENTS.md and a companion) into the repository.
  agentRules: false,
  async headers() {
    return [
      { source: "/:path*", headers: [...securityHeaders, ...isolationHeaders] },
      // Model files are versioned by folder name (ppocr-v4): cache them for a year.
      { source: "/models/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
```

`src/proxy.ts` — replace the `config` export with:

```ts
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|models/|ocr/|fonts/|.*\\.(?:png|jpg|jpeg|svg|ico|onnx|woff2|wasm|mjs)$).*)",
  ],
};
```

- [ ] **Step 10: Bench page (first version: load the models)**

`src/app/dev/ocr-bench/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { devPagesEnabled } from "@/lib/dev-pages";
import { Bench } from "./bench";

export const metadata: Metadata = { title: "OCR bench" };

/** Developer tool (TC-20, TC-24): not user-facing, so its text is English only. */
export default function OcrBenchPage() {
  if (!devPagesEnabled()) notFound();
  return <Bench />;
}
```

`src/app/dev/ocr-bench/bench.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_MODELS, OcrClient } from "@/lib/ocr/client";
import type { InitResult } from "@/lib/ocr/protocol";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function Bench() {
  const client = useRef<OcrClient | null>(null);
  const [init, setInit] = useState<InitResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One Worker per visit; loading models again reuses it (the Worker releases the old sessions).
  useEffect(() => {
    const ocr = new OcrClient();
    client.current = ocr;
    return () => {
      client.current = null;
      void ocr.dispose();
    };
  }, []);

  async function loadModels() {
    setBusy("Loading models");
    setError(null);
    setInit(null);
    try {
      const ocr = client.current;
      if (!ocr) throw new Error("The OCR worker is not running.");
      setInit(await ocr.init({ ...DEFAULT_MODELS }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">OCR bench</h1>
      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-semibold">Models</h2>
        <button
          type="button"
          onClick={loadModels}
          disabled={busy !== null}
          className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50"
        >
          Load models
        </button>
        {init && (
          <p className="font-mono text-sm">
            threads {init.numThreads} · cross-origin isolated {String(init.crossOriginIsolated)} · classes {init.classes} ·
            load {seconds(init.loadMs)} · warm-up {seconds(init.warmupMs)}
          </p>
        )}
      </section>
      {busy && <p role="status">{busy}…</p>}
      {error && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
          {error}
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 11: Verify**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: lint and typecheck clean; Vitest PASS (the 17 earlier unit tests + 5 new; SQL suites skipped without `DATABASE_URL`); `prebuild` prints the "OCR worker built" line; the build lists `/dev/ocr-bench`.

The browser round trip (models load in the Worker, threads > 1, classes 6625) is checked by the controller in Chromium after this task; the implementer does not start a dev server.

- [ ] **Step 12: Commit**

Stage each file by name (the two `.onnx` files, `keys.txt` and `NOTICE.md` included; nothing under `public/ocr/`):

```bash
git add package.json package-lock.json .gitignore .gitattributes eslint.config.mjs next.config.ts src/proxy.ts
git add scripts/build-ocr-worker.mts research/ocr-models/extract_keys.py
git add public/models/NOTICE.md public/models/ppocr-v4/det.onnx public/models/ppocr-v4/rec.onnx public/models/ppocr-v4/keys.txt
git add src/lib/dev-pages.ts src/lib/ocr/alphabet.ts src/lib/ocr/protocol.ts src/lib/ocr/engine.ts src/lib/ocr/worker.ts src/lib/ocr/client.ts
git add src/app/dev/ocr-bench/page.tsx src/app/dev/ocr-bench/bench.tsx tests/unit/ocr/alphabet.test.ts tests/unit/dev-pages.test.ts
git commit -m "feat(ocr): PP-OCRv4 small models in an esbuild-bundled Worker on onnxruntime-web, cross-origin isolated pages"
```

---

### Task 2: Geometry and raster operations

**Files:**
- Create: `src/lib/ocr/geometry.ts`, `src/lib/ocr/raster.ts`
- Test: `tests/unit/ocr/geometry.test.ts`, `tests/unit/ocr/raster.test.ts`

**Interfaces:**
- Produces (`geometry.ts`): `type Point = { x: number; y: number }`; `type Quad = [Point, Point, Point, Point]` (tl, tr, br, bl); `type Rect = { x: number; y: number; w: number; h: number }`; `pyRound(x)`; `clamp(v, lo, hi)`; `distance(a, b)`; `convexHull(points)`; `minAreaRect(points): { corners: Quad; width: number; height: number }`; `miniBox(points): { quad: Quad; shortSide: number }`; `expandRect(quad, d): Quad`; `orderClockwise(points): Quad`; `polygonArea(points)`; `polygonPerimeter(points)`; `bounds(points): Rect`; `rectCentre(rect): Point`.
- Produces (`raster.ts`): `type Raster = { width: number; height: number; data: Uint8ClampedArray }` (RGBA, ImageData-compatible); `createRaster(w, h, gray = 255)`; `crop(src, rect)`; `resizeBilinear(src, w, h)`; `rotate90cw(src)`; `rotate90ccw(src)`; `rotate180(src)`; `rotateExpand(src, degrees)` (counter-clockwise, PIL convention); `unrotatePoint(p, srcW, srcH, outW, outH, degrees)`; `cropQuad(src, quad)`; `toBgrCHW(src, mean = 0.5, std = 0.5)`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/ocr/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  bounds,
  convexHull,
  expandRect,
  minAreaRect,
  miniBox,
  orderClockwise,
  polygonArea,
  polygonPerimeter,
  pyRound,
  type Point,
  type Quad,
} from "@/lib/ocr/geometry";

const pt = (x: number, y: number): Point => ({ x, y });
const close = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("pyRound", () => {
  it("rounds halves to the even neighbour like Python", () => {
    expect(pyRound(62.5)).toBe(62);
    expect(pyRound(63.5)).toBe(64);
    expect(pyRound(-2.5)).toBe(-2);
    expect(pyRound(2.4)).toBe(2);
    expect(pyRound(2.6)).toBe(3);
  });
});

describe("convexHull", () => {
  it("drops interior and duplicate points", () => {
    const hull = convexHull([pt(0, 0), pt(4, 0), pt(4, 3), pt(0, 3), pt(2, 1), pt(0, 0), pt(2, 0)]);
    expect(hull).toHaveLength(4);
    expect(polygonArea(hull)).toBe(12);
  });

  it("keeps a single point", () => {
    expect(convexHull([pt(1, 1), pt(1, 1)])).toEqual([pt(1, 1)]);
  });
});

describe("minAreaRect", () => {
  it("fits an axis-aligned block of pixels", () => {
    const pixels: Point[] = [];
    for (let y = 0; y <= 2; y++) for (let x = 0; x <= 9; x++) pixels.push(pt(x, y));
    const r = minAreaRect(pixels);
    expect(r.width * r.height).toBeCloseTo(18, 6);
    expect(Math.min(r.width, r.height)).toBeCloseTo(2, 6);
  });

  it("fits a rectangle turned by 30°", () => {
    const a = Math.PI / 6;
    const corner = (u: number, v: number) => pt(50 + u * Math.cos(a) - v * Math.sin(a), 40 + u * Math.sin(a) + v * Math.cos(a));
    const r = minAreaRect([corner(-20, -5), corner(20, -5), corner(20, 5), corner(-20, 5), corner(0, 0)]);
    expect(r.width * r.height).toBeCloseTo(400, 4);
    expect(Math.max(r.width, r.height)).toBeCloseTo(40, 4);
  });
});

describe("miniBox", () => {
  it("orders the corners tl, tr, br, bl and reports the shorter side", () => {
    const box = miniBox([pt(10, 20), pt(40, 20), pt(40, 30), pt(10, 30), pt(25, 25)]);
    expect(box.shortSide).toBeCloseTo(10, 6);
    close(box.quad[0], pt(10, 20));
    close(box.quad[1], pt(40, 20));
    close(box.quad[2], pt(40, 30));
    close(box.quad[3], pt(10, 30));
  });
});

describe("expandRect", () => {
  it("grows every side by d around the same centre", () => {
    const quad: Quad = [pt(0, 0), pt(10, 0), pt(10, 4), pt(0, 4)];
    const grown = expandRect(quad, 2);
    close(grown[0], pt(-2, -2));
    close(grown[2], pt(12, 6));
    expect(polygonPerimeter(grown)).toBeCloseTo(44, 6);
  });
});

describe("orderClockwise and bounds", () => {
  it("returns tl, tr, br, bl from any order", () => {
    expect(orderClockwise([pt(9, 9), pt(1, 1), pt(9, 1), pt(1, 9)])).toEqual([pt(1, 1), pt(9, 1), pt(9, 9), pt(1, 9)]);
  });

  it("bounds a set of points", () => {
    expect(bounds([pt(3, 7), pt(1, 2), pt(5, 4)])).toEqual({ x: 1, y: 2, w: 4, h: 5 });
  });
});
```

`tests/unit/ocr/raster.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Quad } from "@/lib/ocr/geometry";
import {
  createRaster,
  crop,
  cropQuad,
  resizeBilinear,
  rotate180,
  rotate90ccw,
  rotate90cw,
  rotateExpand,
  toBgrCHW,
  unrotatePoint,
  type Raster,
} from "@/lib/ocr/raster";

/** A raster from grey levels, row by row. */
function grey(rows: number[][]): Raster {
  const r = createRaster(rows[0].length, rows.length);
  rows.forEach((row, y) =>
    row.forEach((v, x) => {
      const i = (y * r.width + x) * 4;
      r.data[i] = v;
      r.data[i + 1] = v;
      r.data[i + 2] = v;
    }),
  );
  return r;
}
const levels = (r: Raster) =>
  Array.from({ length: r.height }, (_, y) => Array.from({ length: r.width }, (_, x) => r.data[(y * r.width + x) * 4]));

describe("raster basics", () => {
  it("creates an opaque raster of one grey level", () => {
    const r = createRaster(2, 1, 7);
    expect(Array.from(r.data)).toEqual([7, 7, 7, 255, 7, 7, 7, 255]);
  });

  it("crops and fills outside the source with white", () => {
    const r = crop(grey([[1, 2], [3, 4]]), { x: 1, y: 0, w: 2, h: 2 });
    expect(levels(r)).toEqual([[2, 255], [4, 255]]);
  });

  it("resizes with pixel-centre alignment", () => {
    expect(levels(resizeBilinear(grey([[0, 255]]), 4, 1))).toEqual([[0, 64, 191, 255]]);
  });
});

describe("rotations", () => {
  const src = grey([[1, 2, 3], [4, 5, 6]]);

  it("turns a quarter clockwise", () => {
    expect(levels(rotate90cw(src))).toEqual([[4, 1], [5, 2], [6, 3]]);
  });

  it("turns a quarter counter-clockwise", () => {
    expect(levels(rotate90ccw(src))).toEqual([[3, 6], [2, 5], [1, 4]]);
  });

  it("turns half way", () => {
    expect(levels(rotate180(src))).toEqual([[6, 5, 4], [3, 2, 1]]);
  });

  it("rotateExpand by 90° matches the exact quarter turn", () => {
    expect(levels(rotateExpand(src, 90))).toEqual(levels(rotate90ccw(src)));
    expect(levels(rotateExpand(src, -90))).toEqual(levels(rotate90cw(src)));
  });

  it("rotateExpand grows the canvas and paints new corners white", () => {
    const out = rotateExpand(createRaster(10, 10, 0), 45);
    expect(out.width).toBe(15);
    expect(out.height).toBe(15);
    expect(out.data[0]).toBe(255);
    expect(out.data[((7 * out.width) + 7) * 4]).toBe(0);
  });

  it("unrotatePoint inverts the turn", () => {
    const p = unrotatePoint({ x: 0.5, y: 0.5 }, 3, 2, 2, 3, 90);
    expect(p.x).toBeCloseTo(2.5, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
  });
});

describe("cropQuad", () => {
  it("equals a plain crop for an upright box", () => {
    const src = grey([[1, 2, 3, 4, 5, 6, 7], [8, 9, 10, 11, 12, 13, 14], [15, 16, 17, 18, 19, 20, 21], [22, 23, 24, 25, 26, 27, 28]]);
    const quad: Quad = [{ x: 2, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 3 }, { x: 2, y: 3 }];
    expect(levels(cropQuad(src, quad))).toEqual(levels(crop(src, { x: 2, y: 1, w: 4, h: 2 })));
  });

  it("turns a tall crop so the text runs left to right", () => {
    const out = cropQuad(createRaster(10, 10), [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 6 }, { x: 0, y: 6 }]);
    expect(out.width).toBe(6);
    expect(out.height).toBe(2);
  });
});

describe("toBgrCHW", () => {
  it("normalises to [-1, 1] in B, G, R order", () => {
    const r = createRaster(1, 1);
    r.data.set([255, 0, 0, 255]);
    expect(Array.from(toBgrCHW(r))).toEqual([-1, -1, 1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ocr/geometry.test.ts tests/unit/ocr/raster.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/lib/ocr/geometry.ts`:

```ts
/** Geometry for text boxes. Pixel (x, y) has its centre at (x, y), as in OpenCV. */
export type Point = { x: number; y: number };
/** Corners in the order top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];
export type Rect = { x: number; y: number; w: number; h: number };

/** Python's round(): halves go to the even neighbour (kept so sizes match RapidOCR exactly). */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Andrew's monotone chain; collinear and duplicate points are dropped. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const pts = sorted.filter((p, i) => i === 0 || p.x !== sorted[i - 1].x || p.y !== sorted[i - 1].y);
  if (pts.length === 0) return [];
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.length > 0 ? hull : [pts[0]];
}

/** Smallest-area rectangle around the points: rotating calipers over the hull (OpenCV minAreaRect). */
export function minAreaRect(points: readonly Point[]): { corners: Quad; width: number; height: number } {
  const hull = convexHull(points);
  if (hull.length === 0) throw new Error("minAreaRect needs at least one point");
  if (hull.length === 1) {
    const p = hull[0];
    return { corners: [p, p, p, p], width: 0, height: 0 };
  }
  let best: { area: number; u: Point; n: Point; u0: number; u1: number; n0: number; n1: number } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = distance(a, b);
    if (len === 0) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -u.y, y: u.x };
    let u0 = Infinity;
    let u1 = -Infinity;
    let n0 = Infinity;
    let n1 = -Infinity;
    for (const p of hull) {
      const pu = p.x * u.x + p.y * u.y;
      const pn = p.x * n.x + p.y * n.y;
      u0 = Math.min(u0, pu);
      u1 = Math.max(u1, pu);
      n0 = Math.min(n0, pn);
      n1 = Math.max(n1, pn);
    }
    const area = (u1 - u0) * (n1 - n0);
    if (best === null || area < best.area - 1e-9) best = { area, u, n, u0, u1, n0, n1 };
  }
  const { u, n, u0, u1, n0, n1 } = best!;
  const at = (pu: number, pn: number): Point => ({ x: u.x * pu + n.x * pn, y: u.y * pu + n.y * pn });
  return { corners: [at(u0, n0), at(u1, n0), at(u1, n1), at(u0, n1)], width: u1 - u0, height: n1 - n0 };
}

/** RapidOCR get_mini_boxes: the min-area rectangle as tl, tr, br, bl, and its shorter side. */
export function miniBox(points: readonly Point[]): { quad: Quad; shortSide: number } {
  const rect = minAreaRect(points);
  const p = [...rect.corners].sort((a, b) => a.x - b.x);
  const [i1, i4] = p[1].y > p[0].y ? [0, 1] : [1, 0];
  const [i2, i3] = p[3].y > p[2].y ? [2, 3] : [3, 2];
  return { quad: [p[i1], p[i2], p[i3], p[i4]], shortSide: Math.min(rect.width, rect.height) };
}

/**
 * The rectangle tl, tr, br, bl grown by d on every side. For a rectangle this is exactly the
 * min-area box of pyclipper's round offset, which RapidOCR's unclip computes.
 */
export function expandRect(quad: Quad, d: number): Quad {
  const [tl, tr, , bl] = quad;
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  const w = distance(tl, tr);
  const h = distance(tl, bl);
  const u = w > 0 ? { x: (tr.x - tl.x) / w, y: (tr.y - tl.y) / w } : { x: 1, y: 0 };
  const v = h > 0 ? { x: (bl.x - tl.x) / h, y: (bl.y - tl.y) / h } : { x: -u.y, y: u.x };
  const hw = w / 2 + d;
  const hh = h / 2 + d;
  const at = (su: number, sv: number): Point => ({ x: cx + su * hw * u.x + sv * hh * v.x, y: cy + su * hw * u.y + sv * hh * v.y });
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

/** RapidOCR order_points_clockwise: tl, tr, br, bl. */
export function orderClockwise(points: readonly Point[]): Quad {
  const xs = [...points].sort((a, b) => a.x - b.x);
  const [tl, bl] = xs.slice(0, 2).sort((a, b) => a.y - b.y);
  const [tr, br] = xs.slice(2, 4).sort((a, b) => a.y - b.y);
  return [tl, tr, br, bl];
}

export function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeter(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += distance(points[i], points[(i + 1) % points.length]);
  return sum;
}

export function bounds(points: readonly Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function rectCentre(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
```

`src/lib/ocr/raster.ts`:

```ts
import { distance, type Point, type Quad, type Rect } from "./geometry";

/**
 * RGBA pixels, row by row (ImageData satisfies this type). Plain arrays rather than canvas, so the
 * same code runs in the Worker and in Vitest.
 */
export type Raster = { width: number; height: number; data: Uint8ClampedArray };

/** A width × height raster of one grey level, fully opaque. */
export function createRaster(width: number, height: number, gray = 255): Raster {
  if (!(width >= 1 && height >= 1)) throw new Error(`Raster size must be positive, got ${width}×${height}`);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function copyPixel(src: Raster, si: number, out: Raster, di: number): void {
  out.data[di] = src.data[si];
  out.data[di + 1] = src.data[si + 1];
  out.data[di + 2] = src.data[si + 2];
  out.data[di + 3] = 255;
}

/** Copies a rectangle; whatever lies outside the source stays white (the sheet's paper). */
export function crop(src: Raster, rect: Rect): Raster {
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const out = createRaster(Math.max(1, Math.round(rect.w)), Math.max(1, Math.round(rect.h)));
  for (let y = 0; y < out.height; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= src.height) continue;
    for (let x = 0; x < out.width; x++) {
      const sx = x0 + x;
      if (sx < 0 || sx >= src.width) continue;
      copyPixel(src, (sy * src.width + sx) * 4, out, (y * out.width + x) * 4);
    }
  }
  return out;
}

/**
 * Bilinear sample at (fx, fy) into out[oi..oi+3]. Outside the source: the `outside` grey level when
 * given, otherwise the nearest edge pixel (OpenCV BORDER_REPLICATE).
 */
function sampleInto(src: Raster, fx: number, fy: number, out: Uint8ClampedArray, oi: number, outside?: number): void {
  out[oi + 3] = 255;
  if (outside !== undefined && (fx < -0.5 || fy < -0.5 || fx > src.width - 0.5 || fy > src.height - 0.5)) {
    out[oi] = outside;
    out[oi + 1] = outside;
    out[oi + 2] = outside;
    return;
  }
  const x = Math.min(Math.max(fx, 0), src.width - 1);
  const y = Math.min(Math.max(fy, 0), src.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, src.width - 1);
  const y1 = Math.min(y0 + 1, src.height - 1);
  const ax = x - x0;
  const ay = y - y0;
  const r0 = y0 * src.width;
  const r1 = y1 * src.width;
  for (let c = 0; c < 3; c++) {
    const top = src.data[(r0 + x0) * 4 + c] * (1 - ax) + src.data[(r0 + x1) * 4 + c] * ax;
    const bottom = src.data[(r1 + x0) * 4 + c] * (1 - ax) + src.data[(r1 + x1) * 4 + c] * ax;
    out[oi + c] = top * (1 - ay) + bottom * ay;
  }
}

/** Bilinear resize with pixel-centre alignment (OpenCV INTER_LINEAR). */
export function resizeBilinear(src: Raster, width: number, height: number): Raster {
  const out = createRaster(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < width; x++) sampleInto(src, (x + 0.5) * sx - 0.5, fy, out.data, (y * width + x) * 4);
  }
  return out;
}

/** A quarter turn clockwise: text running bottom to top becomes horizontal. */
export function rotate90cw(src: Raster): Raster {
  const out = createRaster(src.height, src.width);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) copyPixel(src, ((src.height - 1 - x) * src.width + y) * 4, out, (y * out.width + x) * 4);
  }
  return out;
}

/** A quarter turn counter-clockwise (numpy rot90). */
export function rotate90ccw(src: Raster): Raster {
  const out = createRaster(src.height, src.width);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) copyPixel(src, (x * src.width + (src.width - 1 - y)) * 4, out, (y * out.width + x) * 4);
  }
  return out;
}

export function rotate180(src: Raster): Raster {
  const out = createRaster(src.width, src.height);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      copyPixel(src, ((src.height - 1 - y) * src.width + (src.width - 1 - x)) * 4, out, (y * out.width + x) * 4);
    }
  }
  return out;
}

/**
 * Where a point of a rotateExpand() output lies in the source. Continuous coordinates: (0, 0) is the
 * top-left corner of the image, so pixel (x, y) spans x..x+1.
 */
export function unrotatePoint(p: Point, srcW: number, srcH: number, outW: number, outH: number, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - outW / 2;
  const dy = p.y - outH / 2;
  return { x: srcW / 2 + dx * cos - dy * sin, y: srcH / 2 + dx * sin + dy * cos };
}

/**
 * Turns the image `degrees` counter-clockwise around its centre and grows the canvas to fit
 * (PIL Image.rotate(expand=True)); the new corners are white.
 */
export function rotateExpand(src: Raster, degrees: number): Raster {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const width = Math.ceil(src.width * cos + src.height * sin - 1e-6);
  const height = Math.ceil(src.width * sin + src.height * cos - 1e-6);
  const out = createRaster(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = unrotatePoint({ x: x + 0.5, y: y + 0.5 }, src.width, src.height, width, height, degrees);
      sampleInto(src, p.x - 0.5, p.y - 0.5, out.data, (y * width + x) * 4, 255);
    }
  }
  return out;
}

/**
 * Straightens the quadrilateral tl, tr, br, bl into an upright image (RapidOCR get_rotate_crop_image).
 * A crop at least 1.5 times taller than wide is turned a quarter counter-clockwise so the text runs left
 * to right.
 */
export function cropQuad(src: Raster, quad: Quad): Raster {
  const [tl, tr, br, bl] = quad;
  const width = Math.max(1, Math.trunc(Math.max(distance(tl, tr), distance(br, bl))));
  const height = Math.max(1, Math.trunc(Math.max(distance(tl, bl), distance(tr, br))));
  const out = createRaster(width, height);
  for (let v = 0; v < height; v++) {
    const t = v / height;
    for (let u = 0; u < width; u++) {
      const s = u / width;
      const fx = (1 - s) * (1 - t) * tl.x + s * (1 - t) * tr.x + s * t * br.x + (1 - s) * t * bl.x;
      const fy = (1 - s) * (1 - t) * tl.y + s * (1 - t) * tr.y + s * t * br.y + (1 - s) * t * bl.y;
      sampleInto(src, fx, fy, out.data, (v * width + u) * 4);
    }
  }
  return height / width >= 1.5 ? rotate90ccw(out) : out;
}

/** CHW float tensor in B, G, R order (the models were trained on OpenCV's BGR images): (v / 255 − mean) / std. */
export function toBgrCHW(src: Raster, mean = 0.5, std = 0.5): Float32Array {
  const plane = src.width * src.height;
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    const p = i * 4;
    out[i] = (src.data[p + 2] / 255 - mean) / std;
    out[plane + i] = (src.data[p + 1] / 255 - mean) / std;
    out[2 * plane + i] = (src.data[p] / 255 - mean) / std;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ocr/geometry.test.ts tests/unit/ocr/raster.test.ts`
Expected: PASS (21 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ocr/geometry.ts src/lib/ocr/raster.ts tests/unit/ocr/geometry.test.ts tests/unit/ocr/raster.test.ts
git commit -m "feat(ocr): box geometry and canvas-free raster operations for the OCR pipeline"
```

---

### Task 3: Text detection post-processing, checked against RapidOCR

**Files:**
- Create: `src/lib/ocr/det.ts`, `research/ocr-parity/make_fixtures.py`, `research/ocr-parity/README.md`, `tests/unit/ocr/fixtures/det-mixed.json`, `tests/unit/ocr/fixtures/det-vertical.json`, `tests/unit/ocr/fixtures/ctc.json` (the CTC fixture is used in Task 4)
- Test: `tests/unit/ocr/det.test.ts`

**Interfaces:**
- Consumes: `geometry.ts` (Task 2).
- Produces: `type DetOptions`; `DET_DEFAULTS` (`thresh 0.3, boxThresh 0.5, unclipRatio 1.6, maxCandidates 1000, minSize 3, dilate true`); `type DetBox = { quad: Quad; score: number }`; `detInputSize(width, height, limitSideLen = 736): { width; height }`; `dbPostprocess(prob: Float32Array, mapW, mapH, srcW, srcH, opts = DET_DEFAULTS): DetBox[]`.

- [ ] **Step 1: Parity fixture generator**

`research/ocr-parity/make_fixtures.py`:

```python
"""Write tests/unit/ocr/fixtures/*.json from RapidOCR's own DBPostProcess and CTCLabelDecode.

Synthetic inputs only (no sheet image). The TypeScript ports in src/lib/ocr must reproduce these
outputs. Regenerate after changing a case:

    python -m venv .venv
    .venv/Scripts/python -m pip install rapidocr==3.9.2 onnxruntime
    .venv/Scripts/python make_fixtures.py
"""
import json
import math
import os

import cv2
import numpy as np
from rapidocr.ch_ppocr_det.utils import DBPostProcess
from rapidocr.ch_ppocr_rec.utils import CTCLabelDecode

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "tests", "unit", "ocr", "fixtures")


def rect_poly(cx, cy, w, h, deg):
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    corners = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    return np.array([[round(cx + x * ca - y * sa), round(cy + x * sa + y * ca)] for x, y in corners], dtype=np.int32)


def det_case(name, map_w, map_h, src_w, src_h, shapes):
    prob = np.zeros((map_h, map_w), dtype=np.float32)
    for cx, cy, w, h, deg, value in shapes:
        cv2.fillPoly(prob, [rect_poly(cx, cy, w, h, deg)], float(value))
    post = DBPostProcess(thresh=0.3, box_thresh=0.5, max_candidates=1000, unclip_ratio=1.6,
                         score_mode="fast", use_dilation=True)
    boxes, scores = post(prob[None, None, :, :], (src_h, src_w))
    case = {
        "name": name, "mapW": map_w, "mapH": map_h, "srcW": src_w, "srcH": src_h,
        "shapes": [list(s) for s in shapes],
        "prob": [round(float(v), 4) for v in prob.flatten()],
        "boxes": [[[float(x), float(y)] for x, y in box] for box in boxes],
        "scores": [round(float(s), 4) for s in scores],
    }
    with open(os.path.join(OUT, f"det-{name}.json"), "w", encoding="utf-8") as f:
        json.dump(case, f)
    print(f"det-{name}: {len(boxes)} boxes")


def ctc_case():
    chars = list("0123456789.")
    decode = CTCLabelDecode(character=list(chars))
    classes = len(chars) + 2
    rng = np.random.default_rng(7)
    logits = rng.normal(0, 1, (3, 20, classes)).astype(np.float32)
    # Sample 0 spells 16.30 with repeats and blanks between letters.
    for t, c in enumerate([0, 2, 2, 0, 7, 0, 11, 11, 0, 4, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0]):
        logits[0, t, c] += 8.0
    # Sample 1 is all blank.
    logits[1, :, 0] += 8.0
    probs = np.exp(logits) / np.exp(logits).sum(axis=2, keepdims=True)
    lines, _ = decode(probs)
    case = {
        "chars": chars, "dims": list(probs.shape),
        "probs": [round(float(v), 6) for v in probs.flatten()],
        "expected": [[text, float(score)] for text, score in lines],
    }
    with open(os.path.join(OUT, "ctc.json"), "w", encoding="utf-8") as f:
        json.dump(case, f)
    print("ctc:", case["expected"])


os.makedirs(OUT, exist_ok=True)
det_case("mixed", 128, 64, 192, 96, [
    (30, 16, 40, 10, 0, 0.8),    # upright line
    (90, 40, 36, 10, 25, 0.7),   # turned 25 degrees
    (20, 50, 1, 1, 0, 0.9),      # a single pixel: dropped (shorter side under 3)
    (100, 12, 30, 8, 0, 0.4),    # above thresh, below box_thresh: dropped
])
det_case("vertical", 64, 128, 64, 128, [
    (32, 64, 8, 50, 0, 0.85),    # a vertical value
])
ctc_case()
```

`research/ocr-parity/README.md`:

```markdown
# OCR parity fixtures

`make_fixtures.py` runs RapidOCR 3.9.2's own `DBPostProcess` (text detection post-processing) and
`CTCLabelDecode` (recognition decoding) on synthetic inputs and writes the inputs and outputs to
`tests/unit/ocr/fixtures/`. The unit tests check that the TypeScript ports in `src/lib/ocr/` give the
same results (boxes within 2 px, scores within 0.02).

No sheet image is involved. Re-run the script only when a synthetic case changes; see the header of
`make_fixtures.py` for the commands.
```

Run it with the existing RapidOCR 3.9.2 environment (it can take a minute to import on this PC; run it in the background if needed):

```bash
cd research/ocr-parity && .venv/Scripts/python make_fixtures.py
```

Expected: `det-mixed: 2 boxes`, `det-vertical: 1 boxes`, and the `ctc:` line starting with `[['16.30', …], ['', 0.0], …]`. If the counts differ, report them instead of editing the cases.

- [ ] **Step 2: Write the failing test**

`tests/unit/ocr/det.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dbPostprocess, detInputSize, type DetBox } from "@/lib/ocr/det";

type DetCase = {
  mapW: number;
  mapH: number;
  srcW: number;
  srcH: number;
  prob: number[];
  boxes: [number, number][][];
  scores: number[];
};

function load(name: string): DetCase {
  return JSON.parse(readFileSync(path.join(process.cwd(), "tests/unit/ocr/fixtures", name), "utf8"));
}

const centre = (pts: { x: number; y: number }[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

function expectSameBoxes(actual: DetBox[], c: DetCase) {
  expect(actual).toHaveLength(c.boxes.length);
  const expected = c.boxes.map((b, i) => ({ quad: b.map(([x, y]) => ({ x, y })), score: c.scores[i] }));
  for (const e of expected) {
    const ec = centre(e.quad);
    const match = actual.find((a) => Math.hypot(centre(a.quad).x - ec.x, centre(a.quad).y - ec.y) < 4);
    expect(match, `a box near (${ec.x}, ${ec.y})`).toBeDefined();
    e.quad.forEach((p, k) => {
      expect(Math.abs(match!.quad[k].x - p.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(match!.quad[k].y - p.y)).toBeLessThanOrEqual(2);
    });
    expect(Math.abs(match!.score - e.score)).toBeLessThanOrEqual(0.02);
  }
}

describe("detInputSize", () => {
  it("scales the shorter side up to 736 and rounds to multiples of 32", () => {
    expect(detInputSize(256, 256)).toEqual({ width: 736, height: 736 });
    expect(detInputSize(350, 350)).toEqual({ width: 736, height: 736 });
    expect(detInputSize(64, 32)).toEqual({ width: 1472, height: 736 });
  });

  it("only rounds an image that is already large enough, halves to even like Python", () => {
    expect(detInputSize(1984, 1504)).toEqual({ width: 1984, height: 1504 });
    expect(detInputSize(2000, 1519)).toEqual({ width: 1984, height: 1504 }); // 2000 / 32 = 62.5 → 62
  });
});

describe("dbPostprocess matches RapidOCR", () => {
  for (const name of ["det-mixed.json", "det-vertical.json"]) {
    it(name, () => {
      const c = load(name);
      expectSameBoxes(dbPostprocess(Float32Array.from(c.prob), c.mapW, c.mapH, c.srcW, c.srcH), c);
    });
  }

  it("finds nothing in an empty map", () => {
    expect(dbPostprocess(new Float32Array(32 * 32), 32, 32, 32, 32)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/ocr/det.test.ts`
Expected: FAIL — cannot resolve `@/lib/ocr/det`.

- [ ] **Step 4: Implement**

`src/lib/ocr/det.ts`:

```ts
import {
  clamp,
  distance,
  expandRect,
  miniBox,
  orderClockwise,
  polygonArea,
  polygonPerimeter,
  pyRound,
  type Point,
  type Quad,
} from "./geometry";

/** RapidOCR 3.9.2 Det settings (config.yaml). */
export type DetOptions = {
  thresh: number;
  boxThresh: number;
  unclipRatio: number;
  maxCandidates: number;
  minSize: number;
  dilate: boolean;
};

export const DET_DEFAULTS: DetOptions = {
  thresh: 0.3,
  boxThresh: 0.5,
  unclipRatio: 1.6,
  maxCandidates: 1000,
  minSize: 3,
  dilate: true,
};

export type DetBox = { quad: Quad; score: number };

/** Detector input size: shorter side at least 736, both sides multiples of 32 (DetPreProcess, limit_type "min"). */
export function detInputSize(width: number, height: number, limitSideLen = 736): { width: number; height: number } {
  const shorter = Math.min(width, height);
  const ratio = shorter < limitSideLen ? limitSideLen / shorter : 1;
  return {
    width: Math.max(32, pyRound(Math.trunc(width * ratio) / 32) * 32),
    height: Math.max(32, pyRound(Math.trunc(height * ratio) / 32) * 32),
  };
}

/** cv2.dilate with a 2×2 kernel: a pixel is set when it or its left, upper or upper-left neighbour is. */
function dilate2x2(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = src[i] | (x > 0 ? src[i - 1] : 0) | (y > 0 ? src[i - w] : 0) | (x > 0 && y > 0 ? src[i - w - 1] : 0);
    }
  }
  return out;
}

/** 8-connected regions, each as the leftmost and rightmost pixel of every row it covers (enough for the hull). */
function regions(mask: Uint8Array, w: number, h: number): Point[][] {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const result: Point[][] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const rows = new Map<number, [number, number]>();
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      const row = rows.get(y);
      if (!row) rows.set(y, [x, x]);
      else {
        if (x < row[0]) row[0] = x;
        if (x > row[1]) row[1] = x;
      }
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
          const j = ny * w + nx;
          if (mask[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    const outline: Point[] = [];
    for (const [y, [a, b]] of rows) {
      outline.push({ x: a, y });
      if (b !== a) outline.push({ x: b, y });
    }
    result.push(outline);
  }
  return result;
}

/** The x-range a convex polygon covers on row y, or null. */
function rowSpan(pts: readonly Point[], y: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (y < Math.min(a.y, b.y) || y > Math.max(a.y, b.y)) continue;
    if (a.y === b.y) {
      lo = Math.min(lo, a.x, b.x);
      hi = Math.max(hi, a.x, b.x);
      continue;
    }
    const x = a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return lo <= hi ? [lo, hi] : null;
}

/** OpenCV's 8-connected Bresenham line between whole-pixel points, both ends included. */
function line(a: Point, b: Point, put: (x: number, y: number) => void): void {
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    put(x, y);
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * box_score_fast: mean probability over the pixels cv2.fillPoly paints for the box with its corners
 * truncated to whole pixels — the interior spans plus the outline drawn as 8-connected lines.
 */
function meanInside(prob: Float32Array, w: number, h: number, quad: Quad): number {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const xMin = clamp(Math.floor(Math.min(...xs)), 0, w - 1);
  const xMax = clamp(Math.ceil(Math.max(...xs)), 0, w - 1);
  const yMin = clamp(Math.floor(Math.min(...ys)), 0, h - 1);
  const yMax = clamp(Math.ceil(Math.max(...ys)), 0, h - 1);
  const pts = quad.map((p) => ({ x: Math.trunc(p.x), y: Math.trunc(p.y) }));
  const bw = xMax - xMin + 1;
  const mask = new Uint8Array(bw * (yMax - yMin + 1));
  const put = (x: number, y: number) => {
    if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) mask[(y - yMin) * bw + (x - xMin)] = 1;
  };
  for (let y = yMin; y <= yMax; y++) {
    const span = rowSpan(pts, y);
    if (!span) continue;
    for (let x = Math.ceil(span[0] - 1e-9); x <= Math.floor(span[1] + 1e-9); x++) put(x, y);
  }
  for (let i = 0; i < pts.length; i++) line(pts[i], pts[(i + 1) % pts.length], put);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = xMin + (i % bw);
    const y = yMin + Math.trunc(i / bw);
    sum += prob[y * w + x];
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Probability map (mapW × mapH) → text boxes in source-image pixels (srcW × srcH): RapidOCR's
 * DBPostProcess with score_mode "fast", then filter_det_res.
 */
export function dbPostprocess(
  prob: Float32Array,
  mapW: number,
  mapH: number,
  srcW: number,
  srcH: number,
  opts: DetOptions = DET_DEFAULTS,
): DetBox[] {
  const bitmap = new Uint8Array(mapW * mapH);
  for (let i = 0; i < bitmap.length; i++) bitmap[i] = prob[i] > opts.thresh ? 1 : 0;
  const mask = opts.dilate ? dilate2x2(bitmap, mapW, mapH) : bitmap;

  const boxes: DetBox[] = [];
  for (const outline of regions(mask, mapW, mapH).slice(0, opts.maxCandidates)) {
    const first = miniBox(outline);
    if (first.shortSide < opts.minSize) continue;
    const score = meanInside(prob, mapW, mapH, first.quad);
    if (score < opts.boxThresh) continue;
    const d = (polygonArea(first.quad) * opts.unclipRatio) / polygonPerimeter(first.quad);
    const grown = miniBox(expandRect(first.quad, d));
    if (grown.shortSide < opts.minSize + 2) continue;
    const scaled = grown.quad.map((p) => ({
      x: clamp(pyRound((p.x / mapW) * srcW), 0, srcW),
      y: clamp(pyRound((p.y / mapH) * srcH), 0, srcH),
    }));
    const quad = orderClockwise(scaled).map((p) => ({
      x: Math.trunc(clamp(p.x, 0, srcW - 1)),
      y: Math.trunc(clamp(p.y, 0, srcH - 1)),
    })) as Quad;
    if (Math.trunc(distance(quad[0], quad[1])) <= 3 || Math.trunc(distance(quad[0], quad[3])) <= 3) continue;
    boxes.push({ quad, score });
  }
  return boxes;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/ocr/det.test.ts`
Expected: PASS (5 tests). If a parity case fails by more than the tolerance, stop and report the actual and expected boxes; do not widen the tolerance.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ocr/det.ts tests/unit/ocr/det.test.ts research/ocr-parity/make_fixtures.py research/ocr-parity/README.md
git add tests/unit/ocr/fixtures/det-mixed.json tests/unit/ocr/fixtures/det-vertical.json tests/unit/ocr/fixtures/ctc.json
git commit -m "feat(ocr): DB text-detection post-processing ported from RapidOCR, with parity fixtures"
```

---

### Task 4: Recognition batches, CTC decoding and dimension values

**Files:**
- Create: `src/lib/ocr/rec.ts`, `src/lib/ocr/dimension-text.ts`
- Test: `tests/unit/ocr/rec.test.ts`, `tests/unit/ocr/dimension-text.test.ts`

**Interfaces:**
- Consumes: `raster.ts` (Task 2); `buildAlphabet` (Task 1); fixture `ctc.json` (Task 3).
- Produces: `REC_HEIGHT = 48`, `REC_BATCH = 6`; `recBatch(crops: readonly Raster[]): { data: Float32Array; dims: [number, 3, number, number] }`; `type RecResult = { text: string; score: number }`; `ctcDecode(probs: Float32Array, dims: readonly number[], chars: readonly string[]): RecResult[]`; `toDimension(text: string): string | null`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/ocr/rec.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAlphabet } from "@/lib/ocr/alphabet";
import { createRaster } from "@/lib/ocr/raster";
import { ctcDecode, recBatch } from "@/lib/ocr/rec";

describe("recBatch", () => {
  it("resizes every crop to 48 px high and pads to the widest ratio", () => {
    const narrow = createRaster(20, 10, 0);
    const wide = createRaster(100, 10, 0);
    const batch = recBatch([narrow, wide]);
    expect(batch.dims).toEqual([2, 3, 48, 480]);
    const plane = 48 * 480;
    expect(batch.data[0]).toBe(-1); // black pixel, B channel
    expect(batch.data[95]).toBe(-1); // last resized column of the narrow crop (ceil(48 × 2) = 96 wide)
    expect(batch.data[96]).toBe(0); // padding
    expect(batch.data[3 * plane + 479]).toBe(-1); // the wide crop fills its row
  });

  it("never makes a batch narrower than 320 px", () => {
    expect(recBatch([createRaster(10, 10)]).dims).toEqual([1, 3, 48, 320]);
  });

  it("writes B, G, R planes and keeps a fractional crop width", () => {
    const crop = createRaster(25, 10); // ratio 2.5 → resized width ceil(48 × 2.5) = 120
    for (let i = 0; i < crop.data.length; i += 4) {
      crop.data[i] = 255; // R
      crop.data[i + 1] = 0; // G
      crop.data[i + 2] = 51; // B
    }
    const batch = recBatch([crop]);
    const plane = 48 * 320;
    expect(batch.dims).toEqual([1, 3, 48, 320]);
    expect(batch.data[0]).toBeCloseTo(51 / 127.5 - 1, 6);
    expect(batch.data[plane]).toBeCloseTo(-1, 6);
    expect(batch.data[2 * plane]).toBeCloseTo(1, 6);
    expect(batch.data[119]).toBeCloseTo(51 / 127.5 - 1, 6);
    expect(batch.data[120]).toBe(0);
  });
});

describe("ctcDecode", () => {
  it("collapses repeats and drops blanks", () => {
    const chars = buildAlphabet("1\n6\n.\n3\n0\n");
    const steps = [1, 1, 0, 2, 3, 3, 0, 4, 5, 0];
    const probs = new Float32Array(steps.length * chars.length);
    steps.forEach((c, t) => {
      probs[t * chars.length + c] = 0.9;
    });
    expect(ctcDecode(probs, [1, steps.length, chars.length], chars)).toEqual([
      { text: "16.30", score: expect.closeTo(0.9, 6) },
    ]);
  });

  it("keeps a repeated character that a blank separates", () => {
    const chars = buildAlphabet("1\n");
    const probs = new Float32Array(3 * chars.length);
    [1, 0, 1].forEach((c, t) => {
      probs[t * chars.length + c] = 0.9;
    });
    expect(ctcDecode(probs, [1, 3, chars.length], chars)[0].text).toBe("11");
  });

  it("rejects a model whose class count does not match the alphabet", () => {
    expect(() => ctcDecode(new Float32Array(6), [1, 2, 3], ["blank", " "])).toThrow(/classes/);
  });

  it("matches RapidOCR CTCLabelDecode", () => {
    const c = JSON.parse(readFileSync(path.join(process.cwd(), "tests/unit/ocr/fixtures/ctc.json"), "utf8")) as {
      chars: string[];
      dims: number[];
      probs: number[];
      expected: [string, number][];
    };
    const decoded = ctcDecode(Float32Array.from(c.probs), c.dims, buildAlphabet(c.chars.join("\n")));
    expect(decoded.map((d) => d.text)).toEqual(c.expected.map((e) => e[0]));
    decoded.forEach((d, i) => expect(Math.abs(d.score - c.expected[i][1])).toBeLessThanOrEqual(1e-4));
  });
});
```

`tests/unit/ocr/dimension-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toDimension } from "@/lib/ocr/dimension-text";

describe("toDimension (TC-22)", () => {
  it("restores a lost decimal point in 3–4 digit readings", () => {
    expect(toDimension("1630")).toBe("16.30");
    expect(toDimension("170")).toBe("1.70");
  });

  it("keeps readings that already look like a dimension", () => {
    expect(toDimension("2.59")).toBe("2.59");
    expect(toDimension("2,50")).toBe("2.50");
    expect(toDimension("R1.20")).toBe("1.20");
  });

  it("drops anything else", () => {
    expect(toDimension("12345")).toBeNull();
    expect(toDimension("1.2")).toBeNull();
    expect(toDimension("SO")).toBeNull();
    expect(toDimension("")).toBeNull();
  });

  it("trims symbols only at the ends", () => {
    expect(toDimension("16.30mm")).toBe("16.30");
    expect(toDimension("Ø2.50")).toBe("2.50");
    expect(toDimension("16.30.")).toBe("16.30");
  });

  it("drops readings with letters inside instead of guessing", () => {
    expect(toDimension("1l.30")).toBeNull();
    expect(toDimension("1O30")).toBeNull();
    expect(toDimension("16 30")).toBeNull();
  });

  it("rejects a leading zero except in 0.xx", () => {
    expect(toDimension("0170")).toBeNull();
    expect(toDimension("01.70")).toBeNull();
    expect(toDimension("0.50")).toBe("0.50");
    expect(toDimension("050")).toBe("0.50");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ocr/rec.test.ts tests/unit/ocr/dimension-text.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/lib/ocr/rec.ts`:

```ts
import { resizeBilinear, type Raster } from "./raster";

export const REC_HEIGHT = 48;
const REC_MIN_RATIO = 320 / 48;
/** RapidOCR rec_batch_num. */
export const REC_BATCH = 6;

export type RecResult = { text: string; score: number };

/**
 * One recogniser batch (RapidOCR resize_norm_img): every crop resized to 48 px high, normalised to
 * [-1, 1] in B, G, R order, and zero-padded on the right to the batch width.
 */
export function recBatch(crops: readonly Raster[]): { data: Float32Array; dims: [number, 3, number, number] } {
  const maxRatio = Math.max(REC_MIN_RATIO, ...crops.map((c) => c.width / c.height));
  const batchW = Math.trunc(REC_HEIGHT * maxRatio);
  const plane = REC_HEIGHT * batchW;
  const data = new Float32Array(crops.length * 3 * plane);
  crops.forEach((crop, n) => {
    const resizedW = Math.min(batchW, Math.max(1, Math.ceil(REC_HEIGHT * (crop.width / crop.height))));
    const img = resizeBilinear(crop, resizedW, REC_HEIGHT);
    const base = n * 3 * plane;
    for (let y = 0; y < REC_HEIGHT; y++) {
      for (let x = 0; x < resizedW; x++) {
        const p = (y * resizedW + x) * 4;
        const o = y * batchW + x;
        data[base + o] = (img.data[p + 2] / 255 - 0.5) / 0.5;
        data[base + plane + o] = (img.data[p + 1] / 255 - 0.5) / 0.5;
        data[base + 2 * plane + o] = (img.data[p] / 255 - 0.5) / 0.5;
      }
    }
  });
  return { data, dims: [crops.length, 3, REC_HEIGHT, batchW] };
}

/**
 * Greedy CTC decoding of the recogniser's softmax output [n, steps, classes]: take the likeliest class
 * per step, collapse repeats, drop blanks (class 0). The score is the mean probability of the kept steps.
 */
export function ctcDecode(probs: Float32Array, dims: readonly number[], chars: readonly string[]): RecResult[] {
  const [n, steps, classes] = dims;
  if (classes !== chars.length) throw new Error(`The model has ${classes} classes but the alphabet has ${chars.length}.`);
  const results: RecResult[] = [];
  for (let b = 0; b < n; b++) {
    let text = "";
    let sum = 0;
    let kept = 0;
    let previous = -1;
    for (let t = 0; t < steps; t++) {
      const base = (b * steps + t) * classes;
      let best = 0;
      let bestP = probs[base];
      for (let c = 1; c < classes; c++) {
        if (probs[base + c] > bestP) {
          bestP = probs[base + c];
          best = c;
        }
      }
      if (best !== 0 && best !== previous) {
        text += chars[best];
        sum += bestP;
        kept++;
      }
      previous = best;
    }
    results.push({ text, score: kept > 0 ? sum / kept : 0 });
  }
  return results;
}
```

`src/lib/ocr/dimension-text.ts`:

```ts
/** One or two digits before the point (no leading zero except "0.xx"), exactly two after. */
const DIMENSION = /^(0|[1-9]\d?)\.\d{2}$/;

/**
 * A machine reading as a dimension value, or null (UC-04 step 4, TC-22). Symbols are trimmed only at the
 * ends ("R1.20", "Ø2.50", "16.30mm"); anything else inside means the reading is not number-shaped, so it
 * is dropped rather than turned into a plausible wrong value. Readings of only 3–4 digits lost their
 * decimal point: "1630" becomes "16.30". The user still confirms every old value (BR-04).
 */
export function toDimension(text: string): string | null {
  const t = text.replace(/^[^0-9]+/, "").replace(/[^0-9]+$/, "").replace(/,/g, ".");
  const value = /^\d{3,4}$/.test(t) ? `${t.slice(0, -2)}.${t.slice(-2)}` : t;
  return DIMENSION.test(value) ? value : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ocr/rec.test.ts tests/unit/ocr/dimension-text.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ocr/rec.ts src/lib/ocr/dimension-text.ts tests/unit/ocr/rec.test.ts tests/unit/ocr/dimension-text.test.ts
git commit -m "feat(ocr): recogniser batches, CTC decoding and dimension values with decimal-point restore"
```

---

### Task 5: Pipeline, scan, read-on-click and the Worker messages

**Files:**
- Create: `src/lib/ocr/pipeline.ts`, `src/lib/ocr/scan.ts`, `src/lib/ocr/click.ts`
- Modify: `src/lib/ocr/protocol.ts`, `src/lib/ocr/worker.ts`, `src/lib/ocr/client.ts`, `src/lib/ocr/engine.ts` (move `Tensor` and `OcrModels` to `pipeline.ts` and re-export nothing: `engine.ts` imports them from there)
- Test: `tests/unit/ocr/pipeline.test.ts`, `tests/unit/ocr/scan.test.ts`, `tests/unit/ocr/click.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces (`pipeline.ts`): `type Tensor`; `type OcrModels`; `type Reading = { text: string; score: number; quad: Quad }`; `type RegionReader = (models: OcrModels, image: Raster, opts?: { bothDirections?: boolean }) => Promise<Reading[]>`; `MIN_TEXT_SCORE = 0.5`; `fitWithinBounds(img, minSide = 30, maxSide = 2000): { raster; scaleX; scaleY }`; `padVertically(img, widthHeightRatio = 8, minHeight = 30): { raster; top }`; `recognizeCrops(models, crops): Promise<RecResult[]>`; `readRegion: RegionReader`.
- Produces (`scan.ts`): `type Detection = { value: string; text: string; score: number; box: Rect; angle: 0 | -90 }` (`box` in page pixels; `angle` in the design's convention, -90 = vertical reading bottom-up); `SCAN_TARGET_WIDTH = 2100`; `MERGE_DISTANCE = 20 / 1135`; `type ScanResult = { detections: Detection[]; timing: { horizontalMs: number; verticalMs: number } }`; `scanArea(models, page, area, targetWidth = SCAN_TARGET_WIDTH, read: RegionReader = readRegion): Promise<ScanResult>`; `mergeOverlapping(candidates, distance): Detection[]`.
- Produces (`click.ts`): `CLICK_SIDE_FRACTION = 0.056`, `CLICK_SIZE = 256`, `CLICK_ANGLES = [0, 60, -60, 90, -90]`, `CLICK_DEADLINE_MS = 5000`; `type ClickReading = { value: string; text: string; score: number; angle: number; box: Rect }`; `type ReadResult = { reading: ClickReading | null; ms: number; anglesTried: number }`; `readAtPoint(models, page, point, deadlineMs = CLICK_DEADLINE_MS, read: RegionReader = readRegion): Promise<ReadResult>`.
- Produces (protocol/client): requests `setPage { page: Raster }`, `scan { area: Rect; targetWidth?: number }`, `read { point: Point }`; `OcrClient.setPage(page)`, `scan(area, targetWidth?)`, `read(point)`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/ocr/pipeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAlphabet } from "@/lib/ocr/alphabet";
import { fitWithinBounds, padVertically, readRegion, type OcrModels, type Tensor } from "@/lib/ocr/pipeline";
import { createRaster } from "@/lib/ocr/raster";

const chars = buildAlphabet("1\n6\n.\n3\n0\n");

/** A detector that sees one block in the middle of whatever it is given, and a recogniser that reads "16.30". */
function fakeModels(): OcrModels & { recCalls: number } {
  const fake = {
    chars,
    recCalls: 0,
    async detect(input: Tensor): Promise<Tensor> {
      const [, , h, w] = input.dims;
      const data = new Float32Array(w * h);
      for (let y = Math.floor(h * 0.4); y < Math.floor(h * 0.6); y++) {
        for (let x = Math.floor(w * 0.3); x < Math.floor(w * 0.7); x++) data[y * w + x] = 0.9;
      }
      return { data, dims: [1, 1, h, w] };
    },
    async recognize(input: Tensor): Promise<Tensor> {
      fake.recCalls++;
      const n = input.dims[0];
      const steps = [1, 0, 2, 0, 3, 0, 4, 0, 5, 0];
      const data = new Float32Array(n * steps.length * chars.length);
      for (let b = 0; b < n; b++) steps.forEach((c, t) => (data[(b * steps.length + t) * chars.length + c] = 0.9));
      return { data, dims: [n, steps.length, chars.length] };
    },
  };
  return fake;
}

describe("fitWithinBounds", () => {
  it("shrinks the longer side to 2000 px in multiples of 32, like RapidOCR", () => {
    const out = fitWithinBounds(createRaster(2124, 1614));
    expect([out.raster.width, out.raster.height]).toEqual([1984, 1504]);
    expect(out.scaleX).toBeCloseTo(2124 / 1984, 9);
    expect(out.scaleY).toBeCloseTo(1614 / 1504, 9);
  });

  it("leaves a moderate image alone", () => {
    const img = createRaster(256, 256);
    expect(fitWithinBounds(img)).toEqual({ raster: img, scaleX: 1, scaleY: 1 });
  });
});

describe("padVertically", () => {
  it("adds black bands to a very wide image", () => {
    const out = padVertically(createRaster(400, 20));
    expect(out.top).toBe(40);
    expect([out.raster.width, out.raster.height]).toEqual([400, 100]);
    expect(out.raster.data[0]).toBe(0);
    expect(out.raster.data[(40 * 400) * 4]).toBe(255);
  });
});

describe("readRegion", () => {
  it("detects, crops and reads, with boxes in input pixels", async () => {
    const models = fakeModels();
    const readings = await readRegion(models, createRaster(64, 32));
    expect(readings).toHaveLength(1);
    expect(readings[0].text).toBe("16.30");
    expect(readings[0].score).toBeCloseTo(0.9, 6);
    for (const p of readings[0].quad) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(64);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(32);
    }
  });

  it("reads each crop twice when asked to try both directions", async () => {
    const models = fakeModels();
    await readRegion(models, createRaster(64, 32), { bothDirections: true });
    expect(models.recCalls).toBe(2);
  });
});
```

`tests/unit/ocr/scan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Quad } from "@/lib/ocr/geometry";
import type { OcrModels, Reading, RegionReader } from "@/lib/ocr/pipeline";
import { createRaster } from "@/lib/ocr/raster";
import { mergeOverlapping, scanArea, type Detection } from "@/lib/ocr/scan";

const models = {} as OcrModels;
const square = (x: number, y: number, s: number): Quad => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe("scanArea", () => {
  it("maps readings from both orientations back to page pixels", async () => {
    const page = createRaster(400, 300);
    const area = { x: 100, y: 50, w: 200, h: 100 }; // scaled ×2 to 400 × 200
    const read: RegionReader = async (_models, image) => {
      // Upright image is 400 wide; the turned one is 200 wide.
      if (image.width === 400) return [{ text: "16.30", score: 0.9, quad: square(40, 20, 10) } satisfies Reading];
      return [{ text: "2.50", score: 0.8, quad: square(20, 60, 10) }, { text: "SO", score: 0.99, quad: square(0, 0, 5) }];
    };
    const { detections } = await scanArea(models, page, area, 400, read);
    expect(detections).toHaveLength(2);
    const flat = detections.find((d) => d.value === "16.30")!;
    expect(flat.angle).toBe(0);
    expect(flat.box).toEqual({ x: 120, y: 60, w: 5, h: 5 });
    const upright = detections.find((d) => d.value === "2.50")!;
    expect(upright.angle).toBe(-90);
    // turned (20..30, 60..70) → upright (60..70, 169..179) → page (130..135, 134.5..139.5)
    expect(upright.box.x).toBeCloseTo(130, 6);
    expect(upright.box.y).toBeCloseTo(134.5, 6);
    expect(upright.box.w).toBeCloseTo(5, 6);
    expect(upright.box.h).toBeCloseTo(5, 6);
  });
});

describe("mergeOverlapping", () => {
  const det = (value: string, score: number, x: number): Detection => ({ value, text: value, score, angle: 0, box: { x, y: 0, w: 10, h: 5 } });

  it("keeps the more confident of two readings at one place", () => {
    expect(mergeOverlapping([det("2.59", 0.7, 0), det("2.50", 0.9, 4), det("1.70", 0.6, 100)], 20).map((d) => d.value)).toEqual(["2.50", "1.70"]);
  });
});
```

`tests/unit/ocr/click.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CLICK_ANGLES, readAtPoint } from "@/lib/ocr/click";
import type { OcrModels, RegionReader } from "@/lib/ocr/pipeline";
import { createRaster } from "@/lib/ocr/raster";

const models = {} as OcrModels;
const page = createRaster(1135, 877);

describe("readAtPoint (UC-06)", () => {
  it("stops at the first angle that yields a dimension and maps the box to the page", async () => {
    const seen: number[] = [];
    const read: RegionReader = async (_m, image, opts) => {
      expect(opts?.bothDirections).toBe(true);
      seen.push(image.width);
      return [{ text: "1630", score: 0.95, quad: [{ x: 96, y: 112 }, { x: 160, y: 112 }, { x: 160, y: 144 }, { x: 96, y: 144 }] }];
    };
    const result = await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read);
    expect(result.anglesTried).toBe(1);
    expect(result.reading?.value).toBe("16.30");
    expect(result.reading?.angle).toBe(0);
    // side = round(0.056 × 1135) = 64 → crop origin (268, 568), scale 64 / 256 = 0.25
    expect(result.reading?.box).toEqual({ x: 292, y: 596, w: 16, h: 8 });
    expect(seen).toEqual([256]);
  });

  it("tries the other angles in order when nothing is read", async () => {
    let calls = 0;
    const read: RegionReader = async () => {
      calls++;
      return calls < 3 ? [] : [{ text: "2.50", score: 0.8, quad: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }] }];
    };
    const result = await readAtPoint(models, page, { x: 300, y: 600 }, 5000, read);
    expect(result.anglesTried).toBe(3);
    expect(result.reading?.angle).toBe(CLICK_ANGLES[2]);
  });

  it("gives up at the deadline", async () => {
    const read: RegionReader = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return [];
    };
    const result = await readAtPoint(models, page, { x: 300, y: 600 }, 20, read);
    expect(result.reading).toBeNull();
    expect(result.anglesTried).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ocr/pipeline.test.ts tests/unit/ocr/scan.test.ts tests/unit/ocr/click.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the pipeline**

`src/lib/ocr/pipeline.ts`:

```ts
import { dbPostprocess, detInputSize } from "./det";
import { pyRound, type Quad } from "./geometry";
import { createRaster, cropQuad, resizeBilinear, rotate180, toBgrCHW, type Raster } from "./raster";
import { ctcDecode, recBatch, REC_BATCH, type RecResult } from "./rec";

export type Tensor = { data: Float32Array; dims: readonly number[] };

/** The two models behind the pipeline; the Worker backs this with onnxruntime-web, tests with fakes. */
export type OcrModels = {
  detect(input: Tensor): Promise<Tensor>;
  recognize(input: Tensor): Promise<Tensor>;
  chars: readonly string[];
};

export type Reading = { text: string; score: number; quad: Quad };
export type RegionReader = (models: OcrModels, image: Raster, opts?: { bothDirections?: boolean }) => Promise<Reading[]>;

/** RapidOCR Global.text_score. */
export const MIN_TEXT_SCORE = 0.5;

/** RapidOCR's first step: longer side at most 2000 px, shorter at least 30 px, each a multiple of 32. */
export function fitWithinBounds(img: Raster, minSide = 30, maxSide = 2000): { raster: Raster; scaleX: number; scaleY: number } {
  let raster = img;
  let scaleX = 1;
  let scaleY = 1;
  const resize = (ratio: number) => {
    const w = pyRound(Math.trunc(raster.width * ratio) / 32) * 32;
    const h = pyRound(Math.trunc(raster.height * ratio) / 32) * 32;
    if (w <= 0 || h <= 0) throw new Error(`Cannot resize a ${raster.width}×${raster.height} image by ${ratio}.`);
    scaleX *= raster.width / w;
    scaleY *= raster.height / h;
    raster = resizeBilinear(raster, w, h);
  };
  if (Math.max(raster.width, raster.height) > maxSide) resize(maxSide / Math.max(raster.width, raster.height));
  if (Math.min(raster.width, raster.height) < minSide) resize(minSide / Math.min(raster.width, raster.height));
  return { raster, scaleX, scaleY };
}

/** Very wide or very short images get black bands above and below (RapidOCR apply_vertical_padding). */
export function padVertically(img: Raster, widthHeightRatio = 8, minHeight = 30): { raster: Raster; top: number } {
  if (img.height > minHeight && img.width / img.height <= widthHeightRatio) return { raster: img, top: 0 };
  const newHeight = Math.max(Math.trunc(img.width / widthHeightRatio), minHeight) * 2;
  const top = Math.trunc(Math.abs(newHeight - img.height) / 2);
  const out = createRaster(img.width, img.height + 2 * top, 0);
  out.data.set(img.data, top * img.width * 4);
  return { raster: out, top };
}

/** Reads crops in batches of similar width (RapidOCR sorts by aspect ratio); results keep the input order. */
export async function recognizeCrops(models: OcrModels, crops: readonly Raster[]): Promise<RecResult[]> {
  const order = crops.map((_, i) => i).sort((a, b) => crops[a].width / crops[a].height - crops[b].width / crops[b].height);
  const results: RecResult[] = new Array(crops.length);
  for (let start = 0; start < order.length; start += REC_BATCH) {
    const indices = order.slice(start, start + REC_BATCH);
    const output = await models.recognize(recBatch(indices.map((i) => crops[i])));
    ctcDecode(output.data, output.dims, models.chars).forEach((result, k) => {
      results[indices[k]] = result;
    });
  }
  return results;
}

/**
 * Detects and reads every text line in the image: RapidOCR's pipeline without the 180° classifier
 * (callers turn the image themselves). Quads are in input pixels; readings under MIN_TEXT_SCORE are
 * dropped. With bothDirections each crop is also read upside down and the better reading kept.
 */
export const readRegion: RegionReader = async (models, image, opts = {}) => {
  const fitted = fitWithinBounds(image);
  const padded = padVertically(fitted.raster);
  const size = detInputSize(padded.raster.width, padded.raster.height);
  const detImage = resizeBilinear(padded.raster, size.width, size.height);
  const prob = await models.detect({ data: toBgrCHW(detImage), dims: [1, 3, size.height, size.width] });
  const boxes = dbPostprocess(prob.data, prob.dims[3], prob.dims[2], padded.raster.width, padded.raster.height);
  if (boxes.length === 0) return [];

  const crops = boxes.map((box) => cropQuad(padded.raster, box.quad));
  let texts = await recognizeCrops(models, crops);
  if (opts.bothDirections) {
    const flipped = await recognizeCrops(models, crops.map(rotate180));
    texts = texts.map((t, i) => (flipped[i].score > t.score ? flipped[i] : t));
  }

  return boxes
    .map((box, i) => ({
      ...texts[i],
      quad: box.quad.map((p) => ({ x: p.x * fitted.scaleX, y: (p.y - padded.top) * fitted.scaleY })) as Quad,
    }))
    .filter((reading) => reading.score >= MIN_TEXT_SCORE);
};
```

In `src/lib/ocr/engine.ts`, delete the local `Tensor` and `OcrModels` type declarations and import them instead:

```ts
import type { OcrModels, Tensor } from "./pipeline";
```

- [ ] **Step 4: Implement scan and click**

`src/lib/ocr/scan.ts`:

```ts
import { toDimension } from "./dimension-text";
import { bounds, rectCentre, type Point, type Rect } from "./geometry";
import { readRegion, type OcrModels, type Reading, type RegionReader } from "./pipeline";
import { crop, resizeBilinear, rotate90cw, type Raster } from "./raster";

/** A value found on the sheet. `box` is in page pixels; `angle` follows the design (-90 = vertical, read bottom-up). */
export type Detection = { value: string; text: string; score: number; box: Rect; angle: 0 | -90 };
export type ScanResult = { detections: Detection[]; timing: { horizontalMs: number; verticalMs: number } };

/** UC-04 step 3: the drawing area is scaled to about this width before scanning. */
export const SCAN_TARGET_WIDTH = 2100;
/** Readings closer than this (fraction of the page width) are one value: 20 px on the 1135-px sample. */
export const MERGE_DISTANCE = 20 / 1135;

/** UC-04 step 4: where two readings sit at the same place, keep the more confident one. */
export function mergeOverlapping(candidates: readonly Detection[], distance: number): Detection[] {
  const kept: Detection[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const c = rectCentre(candidate.box);
    const clash = kept.some((k) => {
      const kc = rectCentre(k.box);
      return Math.abs(kc.x - c.x) <= distance && Math.abs(kc.y - c.y) <= distance;
    });
    if (!clash) kept.push(candidate);
  }
  return kept;
}

/** UC-04 steps 3–4: scan the drawing area at 0° and 90° clockwise and keep number-shaped readings. */
export async function scanArea(
  models: OcrModels,
  page: Raster,
  area: Rect,
  targetWidth: number = SCAN_TARGET_WIDTH,
  read: RegionReader = readRegion,
): Promise<ScanResult> {
  const frame = crop(page, area);
  const width = Math.round(targetWidth);
  const height = Math.round(frame.height * (width / frame.width));
  const big = resizeBilinear(frame, width, height);
  const toPage = (p: Point): Point => ({ x: area.x + (p.x * frame.width) / width, y: area.y + (p.y * frame.height) / height });

  const t0 = performance.now();
  const flat = await read(models, big);
  const t1 = performance.now();
  const turned = await read(models, rotate90cw(big));
  const t2 = performance.now();

  const candidates: Detection[] = [];
  const keep = (reading: Reading, angle: 0 | -90, toBig: (p: Point) => Point) => {
    const value = toDimension(reading.text);
    if (value === null) return;
    candidates.push({ value, text: reading.text, score: reading.score, angle, box: bounds(reading.quad.map((p) => toPage(toBig(p)))) });
  };
  flat.forEach((r) => keep(r, 0, (p) => p));
  // A point (x, y) of the clockwise-turned image came from (y, height - 1 - x) of the upright one.
  turned.forEach((r) => keep(r, -90, (p) => ({ x: p.y, y: height - 1 - p.x })));

  return {
    detections: mergeOverlapping(candidates, MERGE_DISTANCE * page.width),
    timing: { horizontalMs: t1 - t0, verticalMs: t2 - t1 },
  };
}
```

`src/lib/ocr/click.ts`:

```ts
import { toDimension } from "./dimension-text";
import { bounds, type Point, type Rect } from "./geometry";
import { readRegion, type OcrModels, type RegionReader } from "./pipeline";
import { crop, resizeBilinear, rotateExpand, unrotatePoint, type Raster } from "./raster";

/** UC-06 step 2: the square around a click, as a fraction of the page width, scaled to 256 × 256. */
export const CLICK_SIDE_FRACTION = 0.056;
export const CLICK_SIZE = 256;
/** UC-06: 0° first, then ±60° and ±90° in turn (degrees counter-clockwise). */
export const CLICK_ANGLES = [0, 60, -60, 90, -90] as const;
/** NFR-01 / TC-24. */
export const CLICK_DEADLINE_MS = 5000;

/** `angle` is the turn that made the text horizontal, which is the text's angle in the design's convention. */
export type ClickReading = { value: string; text: string; score: number; angle: number; box: Rect };
export type ReadResult = { reading: ClickReading | null; ms: number; anglesTried: number };

/** UC-06: read the value around a click; stop at the first angle that yields a dimension, or at the deadline. */
export async function readAtPoint(
  models: OcrModels,
  page: Raster,
  point: Point,
  deadlineMs: number = CLICK_DEADLINE_MS,
  read: RegionReader = readRegion,
): Promise<ReadResult> {
  const started = performance.now();
  const side = Math.round(CLICK_SIDE_FRACTION * page.width);
  const origin = { x: Math.round(point.x - side / 2), y: Math.round(point.y - side / 2) };
  const square = resizeBilinear(crop(page, { ...origin, w: side, h: side }), CLICK_SIZE, CLICK_SIZE);
  const scale = side / CLICK_SIZE;

  let anglesTried = 0;
  for (const angle of CLICK_ANGLES) {
    if (anglesTried > 0 && performance.now() - started > deadlineMs) break;
    anglesTried++;
    const image = angle === 0 ? square : rotateExpand(square, angle);
    const readings = await read(models, image, { bothDirections: true });

    let best: ClickReading | null = null;
    for (const reading of readings) {
      const value = toDimension(reading.text);
      if (value === null || (best !== null && best.score >= reading.score)) continue;
      // Back from the turned image to the 256-px square (pixel centres sit at +0.5 in unrotatePoint's
      // coordinates), then to the page.
      const corners = reading.quad.map((p) => {
        const c = angle === 0 ? p : unrotatePoint({ x: p.x + 0.5, y: p.y + 0.5 }, CLICK_SIZE, CLICK_SIZE, image.width, image.height, angle);
        const q = angle === 0 ? c : { x: c.x - 0.5, y: c.y - 0.5 };
        return { x: origin.x + q.x * scale, y: origin.y + q.y * scale };
      });
      best = { value, text: reading.text, score: reading.score, angle, box: bounds(corners) };
    }
    if (best !== null) return { reading: best, ms: performance.now() - started, anglesTried };
    if (performance.now() - started > deadlineMs) break;
  }
  return { reading: null, ms: performance.now() - started, anglesTried };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ocr/pipeline.test.ts tests/unit/ocr/scan.test.ts tests/unit/ocr/click.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Worker messages for pages, scans and clicks**

`src/lib/ocr/protocol.ts` — replace the `OcrRequest` type and add the result re-exports:

```ts
import type { ReadResult } from "./click";
import type { Point, Rect } from "./geometry";
import type { Raster } from "./raster";
import type { ScanResult } from "./scan";

export type { ReadResult, ScanResult };

export type OcrRequest =
  | { id: number; type: "init"; options: InitOptions }
  | { id: number; type: "setPage"; page: Raster }
  | { id: number; type: "scan"; area: Rect; targetWidth?: number }
  | { id: number; type: "read"; point: Point }
  | { id: number; type: "release" };
```

(Keep `ModelInput`, `InitOptions`, `InitResult` and `OcrResponse` as they are; the imports go at the top of the file.)

`src/lib/ocr/worker.ts` — replace the file with:

```ts
import { readAtPoint } from "./click";
import { loadModels, type LoadedModels } from "./engine";
import type { OcrRequest, OcrResponse } from "./protocol";
import type { Raster } from "./raster";
import { scanArea } from "./scan";

let models: LoadedModels | null = null;
/** The current sheet, kept here so each click sends only a point. */
let page: Raster | null = null;

function need<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`The OCR worker has no ${what} yet.`);
  return value;
}

async function handle(request: OcrRequest): Promise<unknown> {
  switch (request.type) {
    case "init": {
      await models?.release();
      models = null;
      const loaded = await loadModels(request.options);
      models = loaded.models;
      return loaded.info;
    }
    case "setPage":
      page = request.page;
      return null;
    case "scan":
      return scanArea(need(models, "models"), need(page, "page"), request.area, request.targetWidth);
    case "read":
      return readAtPoint(need(models, "models"), need(page, "page"), request.point);
    case "release":
      await models?.release();
      models = null;
      page = null;
      return null;
  }
}

// One request at a time: an onnxruntime-web session must not run twice at once.
let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<OcrRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    let response: OcrResponse;
    try {
      response = { id: request.id, ok: true, result: await handle(request) };
    } catch (error) {
      response = { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    self.postMessage(response);
  });
};
```

`src/lib/ocr/client.ts` — extend the existing `./protocol` type import with `ReadResult` and `ScanResult` (one import statement per module), add these two imports:

```ts
import type { Point, Rect } from "./geometry";
import type { Raster } from "./raster";
```

and these three methods to `OcrClient` (after `init`):

```ts
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
```

- [ ] **Step 7: Verify**

Run: `npm run lint && npm run typecheck && npm test && npm run ocr:build`
Expected: all clean; the full unit suite passes; the Worker bundle builds.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ocr/pipeline.ts src/lib/ocr/scan.ts src/lib/ocr/click.ts src/lib/ocr/protocol.ts src/lib/ocr/worker.ts src/lib/ocr/client.ts src/lib/ocr/engine.ts
git add tests/unit/ocr/pipeline.test.ts tests/unit/ocr/scan.test.ts tests/unit/ocr/click.test.ts
git commit -m "feat(ocr): RapidOCR pipeline, two-orientation scan and read-on-click behind the Worker"
```

---

### Task 6: The bench page (TC-20, TC-24)

**Files:**
- Create: `src/lib/ocr/bench/sample.ts`, `src/lib/ocr/bench/score.ts`, `src/app/dev/ocr-bench/sample/route.ts`
- Modify: `src/app/dev/ocr-bench/bench.tsx` (replace)
- Test: `tests/unit/ocr/score.test.ts`

**Interfaces:**
- Consumes: `OcrClient` (`init`, `setPage`, `scan`, `read`), `DEFAULT_MODELS`, `Detection`, `ClickReading`, `devPagesEnabled()`.
- Produces: `SAMPLE_SIZE`, `SAMPLE_FRAME`, `SAMPLE_TRUTH`, `CLICK_OFFSET`, `NEAR_PX = 20`, `TARGETS = { scanLocated: 9, scanSeconds: 60, clickSeconds: 5 }`; `scoreScan(detections, truth?)`: `{ located; read; stray; rows: { key; detection }[] }`; `scoreClicks(rows, truth?)`: `{ correct; slowestMs }`; `GET /dev/ocr-bench/sample` → `samples/sample.png` (404 when absent or when dev pages are off).

- [ ] **Step 1: Write the failing test**

`tests/unit/ocr/score.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SAMPLE_TRUTH } from "@/lib/ocr/bench/sample";
import { scoreClicks, scoreScan } from "@/lib/ocr/bench/score";
import type { Detection } from "@/lib/ocr/scan";

const at = (x: number, y: number, value: string): Detection => ({ value, text: value, score: 0.9, angle: 0, box: { x: x - 10, y: y - 4, w: 20, h: 8 } });

describe("scoreScan", () => {
  it("counts located, correctly read and stray values like the bake-off", () => {
    const [a, b] = SAMPLE_TRUTH;
    const score = scoreScan([at(a.x, a.y, a.value), at(b.x + 5, b.y - 5, "2.59"), at(10, 10, "9.99")]);
    expect(score.located).toBe(2);
    expect(score.read).toBe(1);
    expect(score.stray).toBe(1);
    expect(score.rows[0].detection?.value).toBe(a.value);
    expect(score.rows[2].detection).toBeNull();
  });
});

describe("scoreClicks", () => {
  it("counts correct readings and the slowest click", () => {
    const rows = SAMPLE_TRUTH.map((t, i) => ({
      key: t.key,
      ms: 100 * (i + 1),
      reading: i < 2 ? { value: t.value, text: t.value, score: 0.9, angle: 0, box: { x: 0, y: 0, w: 1, h: 1 } } : null,
    }));
    expect(scoreClicks(rows)).toEqual({ correct: 2, slowestMs: 1100 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ocr/score.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement truth and scoring**

`src/lib/ocr/bench/sample.ts`:

```ts
import type { Rect } from "../geometry";

/**
 * The 1135 × 877 sample sheet of the 2026-10-06 bake-off. The sheet itself stays outside the repository
 * (it carries order numbers); these are its 11 dimension values and their centres, read by eye
 * (research/ocr-bakeoff/prep.py).
 */
export const SAMPLE_SIZE = { width: 1135, height: 877 };
export const SAMPLE_FRAME: Rect = { x: 52, y: 116, w: 708, h: 538 };

export type TruthValue = { key: string; value: string; x: number; y: number; orient: "horiz" | "vert" | "diag" };

export const SAMPLE_TRUTH: readonly TruthValue[] = [
  { key: "1.20", value: "1.20", x: 265, y: 134, orient: "diag" },
  { key: "2.50a", value: "2.50", x: 328, y: 189, orient: "vert" },
  { key: "6.90", value: "6.90", x: 147, y: 457, orient: "vert" },
  { key: "16.30", value: "16.30", x: 230, y: 536, orient: "horiz" },
  { key: "1.50", value: "1.50", x: 153, y: 605, orient: "vert" },
  { key: "1.70", value: "1.70", x: 296, y: 610, orient: "horiz" },
  { key: "1.80", value: "1.80", x: 538, y: 465, orient: "horiz" },
  { key: "10.29", value: "10.29", x: 650, y: 451, orient: "horiz" },
  { key: "7.05", value: "7.05", x: 703, y: 493, orient: "vert" },
  { key: "4.66", value: "4.66", x: 702, y: 575, orient: "vert" },
  { key: "2.50b", value: "2.50", x: 569, y: 627, orient: "horiz" },
];

/** The bake-off simulated an imprecise click 3 px right of and 2 px below each centre. */
export const CLICK_OFFSET = { x: 3, y: 2 };
/** A reading counts as found when its centre is within this many page pixels of the value's centre. */
export const NEAR_PX = 20;
/** TC-20 and TC-24. */
export const TARGETS = { scanLocated: 9, scanSeconds: 60, clickSeconds: 5 };
```

`src/lib/ocr/bench/score.ts`:

```ts
import type { ClickReading } from "../click";
import { rectCentre, type Point } from "../geometry";
import type { Detection } from "../scan";
import { NEAR_PX, SAMPLE_TRUTH, type TruthValue } from "./sample";

const near = (c: Point, t: TruthValue) => Math.abs(c.x - t.x) <= NEAR_PX && Math.abs(c.y - t.y) <= NEAR_PX;

export type ScanScore = { located: number; read: number; stray: number; rows: { key: string; detection: Detection | null }[] };

/** The bake-off's metrics (research/ocr-bakeoff/metrics.py): located, read correctly, and stray readings. */
export function scoreScan(detections: readonly Detection[], truth: readonly TruthValue[] = SAMPLE_TRUTH): ScanScore {
  const rows = truth.map((t) => {
    const nearby = detections.filter((d) => near(rectCentre(d.box), t));
    return { key: t.key, detection: nearby.find((d) => d.value === t.value) ?? nearby[0] ?? null };
  });
  return {
    located: rows.filter((r) => r.detection !== null).length,
    read: rows.filter((r, i) => r.detection?.value === truth[i].value).length,
    stray: detections.filter((d) => !truth.some((t) => near(rectCentre(d.box), t))).length,
    rows,
  };
}

export type ClickRow = { key: string; reading: ClickReading | null; ms: number };

export function scoreClicks(rows: readonly ClickRow[], truth: readonly TruthValue[] = SAMPLE_TRUTH): { correct: number; slowestMs: number } {
  return {
    correct: rows.filter((r, i) => r.reading?.value === truth[i].value).length,
    slowestMs: Math.max(0, ...rows.map((r) => r.ms)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ocr/score.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Sample route and the full bench**

`src/app/dev/ocr-bench/sample/route.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { devPagesEnabled } from "@/lib/dev-pages";

/**
 * Serves samples/sample.png to the bench. The folder is git-ignored because real sheets carry order
 * numbers; developer tool only.
 */
export async function GET(): Promise<Response> {
  if (!devPagesEnabled()) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(path.join(process.cwd(), "samples", "sample.png"));
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch {
    return new Response("samples/sample.png not found", { status: 404 });
  }
}
```

`src/app/dev/ocr-bench/bench.tsx` — replace the file with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { CLICK_OFFSET, SAMPLE_FRAME, SAMPLE_SIZE, SAMPLE_TRUTH, TARGETS } from "@/lib/ocr/bench/sample";
import { scoreClicks, scoreScan, type ClickRow } from "@/lib/ocr/bench/score";
import { DEFAULT_MODELS, OcrClient } from "@/lib/ocr/client";
import type { InitResult, ScanResult } from "@/lib/ocr/protocol";
import type { Raster } from "@/lib/ocr/raster";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const verdict = (ok: boolean) => (ok ? "PASS" : "FAIL");

async function blobToRaster(blob: Blob): Promise<Raster> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: img.width, height: img.height, data: img.data };
}

type ModelFiles = { det?: File; rec?: File; keys?: File };

export function Bench() {
  const client = useRef<OcrClient | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<Raster | null>(null);
  const [files, setFiles] = useState<ModelFiles>({});
  const [init, setInit] = useState<InitResult | null>(null);
  const [scan, setScan] = useState<{ result: ScanResult; totalMs: number } | null>(null);
  const [clicks, setClicks] = useState<ClickRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One Worker per visit; loading models again reuses it (the Worker releases the old sessions).
  useEffect(() => {
    const ocr = new OcrClient();
    client.current = ocr;
    return () => {
      client.current = null;
      void ocr.dispose();
    };
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !page) return;
    el.width = page.width;
    el.height = page.height;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(page.data), page.width, page.height), 0, 0);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#2563eb";
    ctx.strokeRect(SAMPLE_FRAME.x, SAMPLE_FRAME.y, SAMPLE_FRAME.w, SAMPLE_FRAME.h);
    ctx.strokeStyle = "#16a34a";
    for (const d of scan?.result.detections ?? []) ctx.strokeRect(d.box.x, d.box.y, d.box.w, d.box.h);
    ctx.strokeStyle = "#dc2626";
    for (const r of clicks ?? []) if (r.reading) ctx.strokeRect(r.reading.box.x, r.reading.box.y, r.reading.box.w, r.reading.box.h);
  }, [page, scan, clicks]);

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function ready(): OcrClient {
    if (!client.current || !init) throw new Error("Load the models first.");
    if (!page) throw new Error("Load the sample sheet first.");
    return client.current;
  }

  const loadModels = () =>
    run("Loading models", async () => {
      const ocr = client.current;
      if (!ocr) throw new Error("The OCR worker is not running.");
      setInit(null);
      setScan(null);
      setClicks(null);
      const [det, rec, keys] = await Promise.all([files.det?.arrayBuffer(), files.rec?.arrayBuffer(), files.keys?.arrayBuffer()]);
      setInit(await ocr.init({ det: det ?? DEFAULT_MODELS.det, rec: rec ?? DEFAULT_MODELS.rec, keys: keys ?? DEFAULT_MODELS.keys }));
      if (page) await ocr.setPage(page);
    });

  async function showSample(blob: Blob) {
    const raster = await blobToRaster(blob);
    setPage(raster);
    setScan(null);
    setClicks(null);
    await client.current?.setPage(raster);
  }

  const pickSample = (file: File) => run("Reading the sample", () => showSample(file));

  const loadSampleFromDisk = () =>
    run("Fetching samples/sample.png", async () => {
      const response = await fetch("/dev/ocr-bench/sample", { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      await showSample(await response.blob());
    });

  const runScan = () =>
    run("Scanning the drawing area", async () => {
      const ocr = ready();
      const started = performance.now();
      const result = await ocr.scan(SAMPLE_FRAME);
      setScan({ result, totalMs: performance.now() - started });
    });

  const runClicks = () =>
    run("Clicking the 11 values", async () => {
      const ocr = ready();
      const rows: ClickRow[] = [];
      for (const t of SAMPLE_TRUTH) {
        const res = await ocr.read({ x: t.x + CLICK_OFFSET.x, y: t.y + CLICK_OFFSET.y });
        rows.push({ key: t.key, reading: res.reading, ms: res.ms });
        setClicks([...rows]);
      }
    });

  const scanScore = scan ? scoreScan(scan.result.detections) : null;
  const clickScore = clicks && clicks.length === SAMPLE_TRUTH.length ? scoreClicks(clicks) : null;
  const wrongSize = page && (page.width !== SAMPLE_SIZE.width || page.height !== SAMPLE_SIZE.height);
  const button = "rounded-md bg-accent px-4 py-2 font-semibold text-accent-ink disabled:opacity-50";

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">OCR bench</h1>
        <p className="text-sm text-ink-2">
          TC-20: at least {TARGETS.scanLocated}/11 values located within {TARGETS.scanSeconds} s. TC-24: each click within{" "}
          {TARGETS.clickSeconds} s. Developer tool; the sample sheet never leaves this browser.
        </p>
      </header>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-semibold">1. Models</h2>
        <p className="text-sm text-ink-2">Default: PP-OCRv4 small from /models/ppocr-v4. To compare another model, pick all three files.</p>
        <div className="flex flex-wrap gap-4 text-sm">
          {(["det", "rec", "keys"] as const).map((kind) => (
            <label key={kind} className="flex flex-col gap-1">
              <span>{kind === "keys" ? "Keys file (.txt)" : `${kind} model (.onnx)`}</span>
              <input type="file" accept={kind === "keys" ? ".txt" : ".onnx"} onChange={(e) => setFiles((f) => ({ ...f, [kind]: e.target.files?.[0] }))} />
            </label>
          ))}
        </div>
        <button type="button" onClick={loadModels} disabled={busy !== null} className={button}>
          Load models
        </button>
        {init && (
          <p className="font-mono text-sm">
            threads {init.numThreads} · cross-origin isolated {String(init.crossOriginIsolated)} · classes {init.classes} · load{" "}
            {seconds(init.loadMs)} · warm-up {seconds(init.warmupMs)}
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-semibold">2. Sample sheet</h2>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <button type="button" onClick={loadSampleFromDisk} disabled={busy !== null} className={button}>
            Load samples/sample.png
          </button>
          <label className="flex items-center gap-2">
            <span>or pick a file</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void pickSample(file);
              }}
            />
          </label>
        </div>
        {page && (
          <p className="text-sm">
            {page.width} × {page.height} px
            {wrongSize && ` — the truth coordinates belong to the ${SAMPLE_SIZE.width} × ${SAMPLE_SIZE.height} sample; scores will be wrong.`}
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-semibold">3. Run</h2>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={runScan} disabled={busy !== null} className={button}>
            Scan (0° and 90°)
          </button>
          <button type="button" onClick={runClicks} disabled={busy !== null} className={button}>
            Click the 11 values
          </button>
        </div>
        {scanScore && scan && (
          <p className="font-mono text-sm" data-testid="scan-summary">
            Scan: located {scanScore.located}/11 ({verdict(scanScore.located >= TARGETS.scanLocated)}), read {scanScore.read}/11, stray{" "}
            {scanScore.stray}, total {seconds(scan.totalMs)} ({verdict(scan.totalMs <= TARGETS.scanSeconds * 1000)}; 0°{" "}
            {seconds(scan.result.timing.horizontalMs)}, 90° {seconds(scan.result.timing.verticalMs)})
          </p>
        )}
        {clickScore && (
          <p className="font-mono text-sm" data-testid="click-summary">
            Click: correct {clickScore.correct}/11, slowest {seconds(clickScore.slowestMs)} (
            {verdict(clickScore.slowestMs <= TARGETS.clickSeconds * 1000)})
          </p>
        )}
      </section>

      {busy && <p role="status">{busy}…</p>}
      {error && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {(scanScore || clicks) && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="py-1 pr-3">Value</th>
              <th className="py-1 pr-3">Expected</th>
              <th className="py-1 pr-3">Scan</th>
              <th className="py-1 pr-3">Click</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {SAMPLE_TRUTH.map((t, i) => {
              const d = scanScore?.rows[i].detection;
              const c = clicks?.[i];
              return (
                <tr key={t.key} className="border-b border-line">
                  <td className="py-1 pr-3">{t.key}</td>
                  <td className="py-1 pr-3">{t.value}</td>
                  <td className="py-1 pr-3">{d ? `${d.value} (${Math.round(d.score * 100)}%, ${d.angle}°)` : "—"}</td>
                  <td className="py-1 pr-3">
                    {c ? (c.reading ? `${c.reading.value} (${Math.round(c.reading.score * 100)}%, ${c.reading.angle}°, ${seconds(c.ms)})` : `none (${seconds(c.ms)})`) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {page && <canvas ref={canvas} className="h-auto max-w-full border border-line" aria-label="Sample sheet with the boxes found" />}
    </main>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all clean; the build lists `/dev/ocr-bench` and `/dev/ocr-bench/sample`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ocr/bench/sample.ts src/lib/ocr/bench/score.ts src/app/dev/ocr-bench/sample/route.ts src/app/dev/ocr-bench/bench.tsx tests/unit/ocr/score.test.ts
git commit -m "feat(ocr): bench page that scores the sample sheet against TC-20 and TC-24"
```

---

### Task 7: Measure on the office PC and record the decision (controller)

This task needs a browser, so it is run by hand on the office PC.

- [ ] **Step 1:** Put the bake-off sample at `samples/sample.png` (git-ignored; check `git status` shows nothing new), start the dev server detached (`Start-Process -FilePath npm -ArgumentList "run","dev" -WindowStyle Hidden` in PowerShell), open `http://localhost:3000/dev/ocr-bench` in Chromium.
- [ ] **Step 2:** Load models; record threads, isolation, load and warm-up time. Load the sample; run the scan and the clicks; record both summary lines and the table; take a screenshot.
- [ ] **Step 3:** Repeat the scan once more (a second run shows the warm figure).
- [ ] **Step 4:** Decide against TC-20 (≥ 9/11 located, ≤ 60 s) and TC-24 (≤ 5 s per click):
  - Both pass with v4 small → keep v4 small.
  - Accuracy passes but time fails → try a smaller `SCAN_TARGET_WIDTH` (1600) on the bench before anything else; record both runs.
  - Accuracy fails → compare v6 small on the bench (pick its det/rec files from the RapidOCR models folder and a keys file from `research/ocr-models/extract_keys.py`); keep the better one.
- [ ] **Step 5:** Record the results in `research/ocr-bakeoff/README.md` as "Round 3: in the browser", and update the roadmap's M2 row ("box tightening" moves to M4 with TC-30, where masking needs it). Commit both docs:

```bash
git add research/ocr-bakeoff/README.md docs/plans/2026-10-07-spec-sheet-editor-roadmap.md
git commit -m "docs(ocr): browser OCR results on the office PC and the model decision"
```

---

## M2 exit checklist

- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all green locally.
- [ ] Parity fixtures pass (detection boxes within 2 px, CTC identical text).
- [ ] TC-20 and TC-24 measured in Chromium on the office PC; numbers and the model decision recorded in `research/ocr-bakeoff/README.md`.
- [ ] Diff scanned for `SO2`, `MO2`, `sb_secret_`, `service_role`, `.env.local` and for any file under `samples/` before push.
- [ ] Next: M3 (sheets pipeline) once the Supabase project exists.
