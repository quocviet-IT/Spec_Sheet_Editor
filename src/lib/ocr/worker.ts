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
