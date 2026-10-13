import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "@/feedback/timeout";

describe("withTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives the value when the promise settles in time", async () => {
    const p = withTimeout(new Promise<string>((r) => setTimeout(() => r("done"), 100)), 1000, "late");
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toBe("done");
  });
  it("gives the fallback when it takes too long, and ignores the late value", async () => {
    let finish: (v: string) => void = () => {};
    const p = withTimeout(new Promise<string>((r) => (finish = r)), 1000, "fallback");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe("fallback");
    finish("late");
    await expect(p).resolves.toBe("fallback");
  });
  it("gives the fallback when the promise rejects", async () => {
    await expect(withTimeout(Promise.reject(new Error("x")), 1000, null)).resolves.toBeNull();
  });
});
