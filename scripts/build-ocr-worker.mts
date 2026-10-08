/**
 * Bundles the OCR Worker (src/lib/ocr/worker.ts) into public/ocr/ocr-worker.js and copies the
 * onnxruntime-web runtime it loads into public/ocr/ort/. Turbopack copies `new Worker(new URL(...))`
 * targets without bundling them, so the Worker is built here instead; `predev` and `prebuild` run it.
 * It also copies the pdf.js worker into public/pdfjs/.
 */
import { build, type Plugin } from "esbuild";
import { copyFile, cp, mkdir, rm } from "node:fs/promises";
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

// pdf.js renders PDFs in the browser (UC-03); its worker must be a plain file next to the app.
const pdfjsOut = path.join(root, "public", "pdfjs");
await rm(pdfjsOut, { recursive: true, force: true });
await mkdir(pdfjsOut, { recursive: true });
await copyFile(
  path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs"),
  path.join(pdfjsOut, "pdf.worker.min.mjs"),
);
console.log("pdf.js worker copied: public/pdfjs/pdf.worker.min.mjs");
// Fonts, CMaps, ICC profiles and WASM decoders pdf.js fetches at run time (see getDocument options in render.ts).
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(path.join(root, "node_modules", "pdfjs-dist", dir), path.join(pdfjsOut, dir), { recursive: true });
  console.log(`pdf.js assets copied: public/pdfjs/${dir}/`);
}
