import { describe, expect, it } from "vitest";
import { en, vi } from "@/messages";

function paths(obj: unknown, prefix = ""): string[] {
  if (typeof obj === "string") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
}

function leaves(obj: unknown): string[] {
  if (typeof obj === "string") return [obj];
  return Object.values(obj as Record<string, unknown>).flatMap(leaves);
}

describe("message dictionaries", () => {
  it("have exactly the same keys", () => {
    expect(paths(en).sort()).toEqual(paths(vi).sort());
  });

  it("have no empty strings", () => {
    for (const s of [...leaves(vi), ...leaves(en)]) expect(s.trim()).not.toBe("");
  });
});
