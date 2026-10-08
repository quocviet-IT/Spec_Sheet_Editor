import { describe, expect, it } from "vitest";
import { SAMPLE_TRUTH } from "@/lib/ocr/bench/sample";
import { scoreClicks, scoreScan } from "@/lib/ocr/bench/score";
import type { Quad } from "@/lib/ocr/geometry";
import type { Detection } from "@/lib/ocr/scan";

const at = (x: number, y: number, value: string): Detection => ({
  value,
  text: value,
  score: 0.9,
  angle: 0,
  box: { x: x - 10, y: y - 4, w: 20, h: 8 },
  quad: [{ x: x - 10, y: y - 4 }, { x: x + 10, y: y - 4 }, { x: x + 10, y: y + 4 }, { x: x - 10, y: y + 4 }],
});

describe("scoreScan", () => {
  it("counts located, correctly read and stray values like the bake-off", () => {
    const [a, b] = SAMPLE_TRUTH;
    const score = scoreScan([at(a.x, a.y, a.value), at(b.x + 5, b.y - 5, "2.59"), at(10, 10, "9.99")]);
    expect(score.located).toBe(2);
    expect(score.read).toBe(1);
    expect(score.stray).toBe(1);
    expect(score.rows[0].detection?.value).toBe(a.value);
    expect(score.rows[2].detection).toBeNull();
  });
});

describe("scoreClicks", () => {
  it("counts correct readings and the slowest click", () => {
    const rows = SAMPLE_TRUTH.map((t, i) => ({
      key: t.key,
      ms: 100 * (i + 1),
      reading:
        i < 2
          ? {
              value: t.value,
              text: t.value,
              score: 0.9,
              angle: 0,
              box: { x: 0, y: 0, w: 1, h: 1 },
              quad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] as Quad,
            }
          : null,
    }));
    expect(scoreClicks(rows)).toEqual({ correct: 2, slowestMs: 1100 });
  });
});
