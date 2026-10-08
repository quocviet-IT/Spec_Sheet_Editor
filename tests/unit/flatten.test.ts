import { describe, expect, it } from "vitest";
import { flattenOnWhite } from "@/lib/page/flatten";

describe("flattenOnWhite (TC-11)", () => {
  it("turns transparent areas white, keeps opaque pixels, blends half-transparent ones", () => {
    const data = Uint8ClampedArray.from([0, 0, 0, 0, 10, 20, 30, 255, 0, 0, 0, 128]);
    const out = flattenOnWhite({ width: 3, height: 1, data });
    expect(Array.from(out.data)).toEqual([255, 255, 255, 255, 10, 20, 30, 255, 127, 127, 127, 255]);
    expect(Array.from(data.slice(0, 4))).toEqual([0, 0, 0, 0]); // the input is not changed
  });
});
