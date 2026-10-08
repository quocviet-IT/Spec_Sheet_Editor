import { describe, expect, it } from "vitest";
import { orientationMatrix, orientedSize, readJpegOrientation } from "@/lib/page/orientation";

/** A minimal JPEG: SOI, an APP1 Exif segment with one IFD0 entry (Orientation), then EOI. */
function jpegWithOrientation(value: number, littleEndian: boolean): Uint8Array {
  const tiff: number[] = [];
  const u16 = (n: number) => (littleEndian ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number) => (littleEndian ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24] : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  tiff.push(...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8)); // header, IFD0 at 8
  tiff.push(...u16(1)); // one entry
  tiff.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(value), 0, 0); // Orientation, SHORT, count 1
  tiff.push(...u32(0)); // no next IFD
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = exif.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...exif, 0xff, 0xd9]);
}

describe("readJpegOrientation (TC-10)", () => {
  it("reads Orientation 6 in both byte orders", () => {
    expect(readJpegOrientation(jpegWithOrientation(6, true))).toBe(6);
    expect(readJpegOrientation(jpegWithOrientation(6, false))).toBe(6);
  });

  it("is 1 for a JPEG without Exif, a non-JPEG, or an out-of-range value", () => {
    expect(readJpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);
    expect(readJpegOrientation(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
    expect(readJpegOrientation(jpegWithOrientation(9, true))).toBe(1);
  });
});

describe("orientation transform", () => {
  it("swaps width and height for orientations 5–8, so a portrait-stored photo of a landscape sheet is landscape", () => {
    expect(orientedSize(877, 1135, 6)).toEqual({ width: 1135, height: 877 });
    expect(orientedSize(1135, 877, 1)).toEqual({ width: 1135, height: 877 });
    expect(orientedSize(1135, 877, 3)).toEqual({ width: 1135, height: 877 });
  });

  it("maps the stored top-left corner to where it must appear", () => {
    const at = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    // 6 = rotate 90° clockwise: stored (0,0) lands top-right of the turned image (width = stored height)
    expect(at(orientationMatrix(6, 877, 1135), 0, 0)).toEqual([1135, 0]);
    // 8 = rotate 90° counter-clockwise: stored (0,0) lands bottom-left
    expect(at(orientationMatrix(8, 877, 1135), 0, 0)).toEqual([0, 877]);
    // 3 = 180°: stored (0,0) lands bottom-right
    expect(at(orientationMatrix(3, 1135, 877), 0, 0)).toEqual([1135, 877]);
    expect(orientationMatrix(1, 10, 20)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});
