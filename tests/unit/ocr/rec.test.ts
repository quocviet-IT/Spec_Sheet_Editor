import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAlphabet } from "@/lib/ocr/alphabet";
import { createRaster } from "@/lib/ocr/raster";
import { ctcDecode, recBatch } from "@/lib/ocr/rec";

describe("recBatch", () => {
  it("resizes every crop to 48 px high and pads to the widest ratio", () => {
    const narrow = createRaster(20, 10, 0);
    const wide = createRaster(100, 10, 0);
    const batch = recBatch([narrow, wide]);
    expect(batch.dims).toEqual([2, 3, 48, 480]);
    const plane = 48 * 480;
    expect(batch.data[0]).toBe(-1); // black pixel, B channel
    expect(batch.data[95]).toBe(-1); // last resized column of the narrow crop (ceil(48 × 2) = 96 wide)
    expect(batch.data[96]).toBe(0); // padding
    expect(batch.data[3 * plane + 479]).toBe(-1); // the wide crop fills its row
  });

  it("never makes a batch narrower than 320 px", () => {
    expect(recBatch([createRaster(10, 10)]).dims).toEqual([1, 3, 48, 320]);
  });
});

describe("ctcDecode", () => {
  it("collapses repeats and drops blanks", () => {
    const chars = buildAlphabet("1\n6\n.\n3\n0\n");
    const steps = [1, 1, 0, 2, 3, 3, 0, 4, 5, 0];
    const probs = new Float32Array(steps.length * chars.length);
    steps.forEach((c, t) => {
      probs[t * chars.length + c] = 0.9;
    });
    expect(ctcDecode(probs, [1, steps.length, chars.length], chars)).toEqual([
      { text: "16.30", score: expect.closeTo(0.9, 6) },
    ]);
  });

  it("rejects a model whose class count does not match the alphabet", () => {
    expect(() => ctcDecode(new Float32Array(6), [1, 2, 3], ["blank", " "])).toThrow(/classes/);
  });

  it("matches RapidOCR CTCLabelDecode", () => {
    const c = JSON.parse(readFileSync(path.join(process.cwd(), "tests/unit/ocr/fixtures/ctc.json"), "utf8")) as {
      chars: string[];
      dims: number[];
      probs: number[];
      expected: [string, number][];
    };
    const decoded = ctcDecode(Float32Array.from(c.probs), c.dims, buildAlphabet(c.chars.join("\n")));
    expect(decoded.map((d) => d.text)).toEqual(c.expected.map((e) => e[0]));
    decoded.forEach((d, i) => expect(Math.abs(d.score - c.expected[i][1])).toBeLessThanOrEqual(1e-4));
  });
});
