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
