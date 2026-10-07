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
