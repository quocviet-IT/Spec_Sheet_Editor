import { describe, expect, it } from "vitest";
import { zoomIn, zoomOut } from "@/editor/zoom";

describe("zoom steps", () => {
  it("moves to the next step from any scale, including a fitted one", () => {
    expect(zoomIn(0.2)).toBe(0.25);
    expect(zoomIn(1)).toBe(1.5);
    expect(zoomOut(0.2)).toBe(0.1);
    expect(zoomOut(1)).toBe(0.75);
  });

  it("stops at the ends", () => {
    expect(zoomIn(2)).toBe(2);
    expect(zoomOut(0.1)).toBe(0.1);
  });
});
