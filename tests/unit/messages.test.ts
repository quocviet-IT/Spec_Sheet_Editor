import { describe, expect, it } from "vitest";
import { en, vi } from "@/messages";

function paths(obj: unknown, prefix = ""): string[] {
  if (typeof obj === "string") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
}

function entries(obj: unknown, prefix = ""): [string, string][] {
  if (typeof obj === "string") return [[prefix, obj]];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => entries(v, prefix ? `${prefix}.${k}` : k));
}

function leaves(obj: unknown): string[] {
  return entries(obj).map(([, v]) => v);
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe("message dictionaries", () => {
  it("have exactly the same keys", () => {
    expect(paths(en).sort()).toEqual(paths(vi).sort());
  });

  it("have no empty strings", () => {
    for (const s of [...leaves(vi), ...leaves(en)]) expect(s.trim()).not.toBe("");
  });

  it("use the same placeholders in both languages for every key", () => {
    const viByKey = new Map(entries(vi));
    for (const [key, text] of entries(en)) {
      expect({ key, placeholders: placeholders(viByKey.get(key) ?? "") }).toEqual({ key, placeholders: placeholders(text) });
    }
  });
});
