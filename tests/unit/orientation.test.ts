import { describe, expect, it } from "vitest";
import { needsOwnRotation, orientationMatrix, orientedSize, readJpegOrientation, readJpegSize } from "@/lib/page/orientation";

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

describe("orientationMatrix: all four corners of a w x h image, all 8 values", () => {
  const w = 4;
  const h = 6;
  const at = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4] + 0, m[1] * x + m[3] * y + m[5] + 0];
  // stored corners in the order TL, TR, BL, BR -> where each must land
  const expected: Record<number, number[][]> = {
    1: [[0, 0], [w, 0], [0, h], [w, h]],
    2: [[w, 0], [0, 0], [w, h], [0, h]],
    3: [[w, h], [0, h], [w, 0], [0, 0]],
    4: [[0, h], [w, h], [0, 0], [w, 0]],
    5: [[0, 0], [0, w], [h, 0], [h, w]],
    6: [[h, 0], [h, w], [0, 0], [0, w]],
    7: [[h, w], [h, 0], [0, w], [0, 0]],
    8: [[0, w], [0, 0], [h, w], [h, 0]],
  };
  for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`orientation ${o}`, () => {
      const m = orientationMatrix(o, w, h);
      const corners = [at(m, 0, 0), at(m, w, 0), at(m, 0, h), at(m, w, h)];
      expect(corners).toEqual(expected[o]);
    });
  }
});

/** SOI, then the given segments (each marker + 2-byte length + payload), then optionally EOI. */
function jpeg(...segments: { marker: number; payload: number[] }[]): number[] {
  const out = [0xff, 0xd8];
  for (const s of segments) out.push(0xff, s.marker, (s.payload.length + 2) >> 8, (s.payload.length + 2) & 0xff, ...s.payload);
  return out;
}
const app0 = { marker: 0xe0, payload: [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0] };
const sof0 = (w: number, h: number) => ({ marker: 0xc0, payload: [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1] });

describe("readJpegSize", () => {
  it("finds the size after APP0 and APP1 segments", () => {
    const exif = { marker: 0xe1, payload: [0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3, 4] };
    expect(readJpegSize(Uint8Array.from(jpeg(app0, exif, sof0(1135, 877))))).toEqual({ width: 1135, height: 877 });
  });
  it("is null for a truncated SOF, a missing SOF, or a non-JPEG", () => {
    const bytes = jpeg(app0, sof0(1135, 877));
    expect(readJpegSize(Uint8Array.from(bytes.slice(0, bytes.length - 12)))).toBeNull();
    expect(readJpegSize(Uint8Array.from(jpeg(app0)))).toBeNull();
    expect(readJpegSize(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe("needsOwnRotation", () => {
  const stored = { width: 877, height: 1135 };
  it("is true only when a quarter turn is asked for and the browser left the stored size", () => {
    expect(needsOwnRotation(6, stored, { width: 877, height: 1135 })).toBe(true); // browser did not rotate
    expect(needsOwnRotation(6, stored, { width: 1135, height: 877 })).toBe(false); // browser rotated
    expect(needsOwnRotation(3, stored, { width: 877, height: 1135 })).toBe(false);
    expect(needsOwnRotation(1, stored, { width: 877, height: 1135 })).toBe(false);
    expect(needsOwnRotation(6, { width: 900, height: 900 }, { width: 900, height: 900 })).toBe(false); // square: never rotate
    expect(needsOwnRotation(6, null, { width: 877, height: 1135 })).toBe(false);
  });
});

describe("readJpegOrientation: malformed Exif", () => {
  it("still finds the orientation after an APP0 segment", () => {
    const ex = Array.from(jpegWithOrientation(8, true)).slice(2, -2); // the APP1 segment
    const bytes = Uint8Array.from([0xff, 0xd8, ...jpeg(app0).slice(2), ...ex, 0xff, 0xd9]);
    expect(readJpegOrientation(bytes)).toBe(8);
  });
  it("is 1 for a huge segment length, a huge IFD offset, or a truncated Exif segment", () => {
    const good = Array.from(jpegWithOrientation(6, true));
    const hugeLen = [...good];
    hugeLen[4] = 0xff;
    hugeLen[5] = 0xff;
    expect(readJpegOrientation(Uint8Array.from(hugeLen.slice(0, 20)))).toBe(1);
    const hugeIfd = [...good];
    hugeIfd.splice(16, 4, 0xff, 0xff, 0xff, 0x7f); // IFD0 offset (little endian) far past the segment
    expect(readJpegOrientation(Uint8Array.from(hugeIfd))).toBe(1);
    expect(readJpegOrientation(Uint8Array.from(good.slice(0, 24)))).toBe(1);
  });
});
