import { describe, expect, it } from "vitest";
import { MASK_PAD, planEdit } from "@/editor/compose";
import type { Edit } from "@/editor/types";

const ARIMO = 0.716;

function edit(over: Partial<Edit> = {}): Edit {
  return {
    detectionId: "d1", oldValue: "2.50", newValue: "2.60",
    box: { cx: 0.5, cy: 0.5, w: 0.02, h: 0.01 }, angle: 0, fontPx: 0.01,
    textColor: "#676672", bgColor: "#ffffff", ...over,
  };
}

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9);

describe("planEdit", () => {
  it("masks the digits plus a margin and draws the new value as tall as the old one", () => {
    const p = planEdit(edit(), 1000, 800, ARIMO);
    close(p.cx, 500);
    close(p.cy, 400);
    expect(p.rad).toBe(0);
    const pad = MASK_PAD * 10;
    close(p.maskW, 20 + 2 * pad);
    close(p.maskH, 10 + 2 * pad);
    close(p.fontSize, 10 / ARIMO);
    close(p.baseline, 5); // digits stand on the box's foot, centred across the text
    expect(p).toMatchObject({ text: "2.60", textColor: "#676672", bgColor: "#ffffff" });
  });

  it("turns with the value", () => {
    close(planEdit(edit({ angle: -90 }), 1000, 800, ARIMO).rad, -Math.PI / 2);
    close(planEdit(edit({ angle: 58 }), 1000, 800, ARIMO).rad, (58 * Math.PI) / 180);
  });

  it("keeps at least one pixel of margin for tiny digits", () => {
    const p = planEdit(edit({ box: { cx: 0.5, cy: 0.5, w: 0.004, h: 0.002 }, fontPx: 0.002 }), 1000, 800, ARIMO);
    close(p.maskH, 2 + 2);
  });
});
