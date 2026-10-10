import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCKS, SECTION_IDS, SHOTS, calloutNumbers, type ShotName } from "@/app/(app)/guide/content";
import { en, vi } from "@/messages";

const LOCALES = ["vi", "en"] as const;
type Points = Record<string, { n: number; x: number; y: number }[]>;

function points(locale: string): Points {
  return JSON.parse(readFileSync(join("public/guide", locale, "points.json"), "utf8")) as Points;
}

describe("the user guide", () => {
  it.each(LOCALES)("has every shot as an image in %s, each under 250 KB", (locale) => {
    for (const shot of SHOTS) {
      const path = join("public/guide", locale, `${shot}.jpg`);
      expect(existsSync(path), `${path} should exist`).toBe(true);
      expect(statSync(path).size, `${path} should be under 250 KB`).toBeLessThan(250 * 1024);
    }
  });

  it.each(LOCALES)("has points for every shot in %s, inside the image", (locale) => {
    const all = points(locale);
    for (const shot of SHOTS) {
      expect(all[shot], `${locale} points for ${shot}`).toBeDefined();
      expect(all[shot].length, `${locale} points for ${shot}`).toBeGreaterThan(0);
      for (const p of all[shot]) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(100);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(100);
      }
    }
  });

  it("uses only callout numbers that exist in the shot's points, and every point is explained by a step", () => {
    for (const locale of LOCALES) {
      const all = points(locale);
      const used = new Map<ShotName, number[]>();
      for (const id of SECTION_IDS) {
        for (const block of BLOCKS[id]) {
          if (!block.shot) {
            expect(calloutNumbers(block), `${id}: callouts need a screenshot`).toEqual([]);
            continue;
          }
          used.set(block.shot, calloutNumbers(block));
        }
      }
      for (const shot of SHOTS) {
        const numbers = used.get(shot);
        expect(numbers, `shot ${shot} should be used by a block`).toBeDefined();
        const have = all[shot].map((p) => p.n).sort((a, b) => a - b);
        for (const n of numbers!) expect(have, `${locale}/${shot} has no point ${n}`).toContain(n);
        expect([...numbers!].sort((a, b) => a - b), `${locale}/${shot}: every point needs a step`).toEqual(have);
      }
    }
  });

  it("numbers the steps of a screenshot 1, 2, 3 without gaps or repeats", () => {
    for (const id of SECTION_IDS) {
      for (const block of BLOCKS[id]) {
        const numbers = calloutNumbers(block);
        expect(numbers).toEqual(numbers.map((_, i) => i + 1));
      }
    }
  });

  it("has text for every step, alt and section in both languages", () => {
    for (const dictionary of [vi, en]) {
      const g = dictionary.guide;
      for (const id of SECTION_IDS) {
        expect(g.sections[id].title.length).toBeGreaterThan(0);
        for (const block of BLOCKS[id]) for (const s of block.steps) expect((g.steps as Record<string, string>)[s.key]?.length, s.key).toBeGreaterThan(0);
      }
      for (const shot of SHOTS) expect(g.alt[shot].length).toBeGreaterThan(0);
    }
  });
});
