import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OcrClient } from "@/lib/ocr/client";

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: { id: number; type: string }[] = [];
  terminated = false;
  throwOnPost = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: { id: number; type: string }) {
    if (this.throwOnPost) throw new Error("could not clone");
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => vi.stubGlobal("Worker", FakeWorker));
afterEach(() => vi.unstubAllGlobals());

describe("OcrClient", () => {
  it("answers each request by its id", async () => {
    const client = new OcrClient();
    const pending = client.read({ x: 1, y: 2 });
    const { id } = FakeWorker.last.posted[0];
    FakeWorker.last.onmessage?.({ data: { id, ok: true, result: { reading: null, ms: 1, anglesTried: 1 } } });
    await expect(pending).resolves.toEqual({ reading: null, ms: 1, anglesTried: 1 });
  });

  it("rejects pending and later requests once the worker fails", async () => {
    const client = new OcrClient();
    const pending = client.read({ x: 1, y: 2 });
    FakeWorker.last.onerror?.({ message: "boom" });
    await expect(pending).rejects.toThrow("boom");
    await expect(client.scan({ x: 0, y: 0, w: 1, h: 1 })).rejects.toThrow("boom");
  });

  it("stops at once on dispose and rejects what was pending", async () => {
    const client = new OcrClient();
    const pending = client.read({ x: 1, y: 2 });
    client.dispose();
    expect(FakeWorker.last.terminated).toBe(true);
    await expect(pending).rejects.toThrow("stopped");
  });

  it("does not leave a request pending when posting fails", async () => {
    const client = new OcrClient();
    FakeWorker.last.throwOnPost = true;
    await expect(client.read({ x: 1, y: 2 })).rejects.toThrow("could not clone");
    FakeWorker.last.throwOnPost = false;
    const next = client.read({ x: 3, y: 4 });
    const { id } = FakeWorker.last.posted[0];
    FakeWorker.last.onmessage?.({ data: { id, ok: true, result: { reading: null, ms: 2, anglesTried: 1 } } });
    await expect(next).resolves.toMatchObject({ ms: 2 });
  });
});
