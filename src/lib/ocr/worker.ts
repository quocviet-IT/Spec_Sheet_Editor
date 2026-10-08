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
    case "scan": {
      const loaded = need(models, "models");
      const sheet = need(page, "page");
      const { x, y, w, h } = request.area;
      const inside = [x, y, w, h].every(Number.isFinite) && w >= 1 && h >= 1 && x < sheet.width && y < sheet.height && x + w > 0 && y + h > 0;
      if (!inside) throw new Error("The scan area is empty or outside the page.");
      return scanArea(loaded, sheet, request.area, request.targetWidth);
    }
    case "read": {
      const loaded = need(models, "models");
      const sheet = need(page, "page");
      const { x, y } = request.point;
      const inside = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < sheet.width && y < sheet.height;
      if (!inside) throw new Error("The point is outside the page.");
      return readAtPoint(loaded, sheet, request.point);
    }
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
