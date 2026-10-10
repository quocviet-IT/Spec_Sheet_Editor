import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "@/lib/security/csp";

const directives = (csp: string) =>
  Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

describe("buildCsp", () => {
  const prod = directives(buildCsp({ nonce: "abc", supabaseUrl: "https://ref.supabase.co/", dev: false }));
  const dev = directives(buildCsp({ nonce: "abc", supabaseUrl: "https://ref.supabase.co", dev: true }));

  it("allows scripts only by nonce in production", () => {
    expect(prod["script-src"]).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(prod["script-src"]).not.toContain("'unsafe-inline'");
    expect(prod["script-src"]).not.toContain("'unsafe-eval'");
  });
  it("adds eval and the hot-reload socket only in development", () => {
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toContain("ws:");
    expect(prod["connect-src"]).not.toContain("ws:");
  });
  it("names the Supabase origin, not the full URL", () => {
    expect(prod["connect-src"]).toEqual(["'self'", "https://ref.supabase.co"]);
    expect(prod["img-src"]).toContain("https://ref.supabase.co");
  });
  it("blocks framing, plugins and base changes", () => {
    expect(prod["frame-ancestors"]).toEqual(["'none'"]);
    expect(prod["object-src"]).toEqual(["'none'"]);
    expect(prod["base-uri"]).toEqual(["'self'"]);
    expect(prod["worker-src"]).toEqual(["'self'", "blob:"]);
  });
});

describe("newNonce", () => {
  it("is base64 of 16 bytes and differs each time", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});
