import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOGO_COLORS, logoShapes, logoVariant } from "@/ui/logo-geometry";

describe("logo", () => {
  const svg = readFileSync(join(process.cwd(), "src/app/icon.svg"), "utf8");

  it("icon.svg is a well-formed 64 x 64 SVG with the three brand colours", () => {
    expect(svg).toMatch(/^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg.trim().endsWith("</svg>")).toBe(true);
    for (const c of Object.values(LOGO_COLORS)) expect(svg.toLowerCase()).toContain(c);
    // every opened tag is either self-closed or closed
    const opened = svg.match(/<[a-z]/g)?.length ?? 0;
    const selfClosed = svg.match(/\/>/g)?.length ?? 0;
    const closed = svg.match(/<\/[a-z]+>/g)?.length ?? 0;
    expect(opened).toBe(selfClosed + closed);
  });

  it("uses the detailed geometry from 32 px up and the simplified one below", () => {
    expect(logoVariant(31)).toBe("simple");
    expect(logoVariant(32)).toBe("detailed");
    expect(logoVariant(48)).toBe("detailed");
    expect(logoVariant(16)).toBe("simple");
    const detailed = logoShapes(32);
    const simple = logoShapes(28);
    expect(detailed.ring.strokeWidth).toBe(4);
    expect(simple.ring.strokeWidth).toBe(5);
    expect(detailed.stone).toBe("M27 16.5l5-6 5 6z");
    expect(simple.stone).toBe("M27 17l5-6 5 6z");
    expect(simple.measure).toEqual([{ d: "M14 35h36", strokeWidth: 3.5 }]);
    expect(detailed.measure.length).toBe(3);
  });

  it("the static icon is the simplified mark", () => {
    expect(svg).toContain("M14 35h36");
    expect(svg).toContain('stroke-width="5"');
  });
});
