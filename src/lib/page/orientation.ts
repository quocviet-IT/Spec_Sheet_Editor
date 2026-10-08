/**
 * EXIF Orientation of a JPEG (1–8), read from the APP1 segment. 1 when the file has none, is not a
 * JPEG, or holds an out-of-range value. Applying it ourselves (not the browser's automatic rotation)
 * keeps every browser and the editor in M4 on the same pixels (TC-10).
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return 1;
    const marker = bytes[p + 1];
    if (marker === 0xd9 || marker === 0xda) return 1; // end of image / start of scan: no Exif before it
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if (len < 2) return 1;
    if (marker === 0xe1 && len >= 16 && String.fromCharCode(...bytes.subarray(p + 4, p + 8)) === "Exif") {
      return orientationFromTiff(bytes, p + 10, Math.min(p + 2 + len, bytes.length));
    }
    p += 2 + len;
  }
  return 1;
}

function orientationFromTiff(bytes: Uint8Array, start: number, end: number): number {
  if (start + 8 > end) return 1;
  const little = bytes[start] === 0x49 && bytes[start + 1] === 0x49;
  const big = bytes[start] === 0x4d && bytes[start + 1] === 0x4d;
  if (!little && !big) return 1;
  const u16 = (o: number) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
  const u32 = (o: number) =>
    little
      ? (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0
      : ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const ifd = start + u32(start + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Size after applying the orientation: 5–8 turn the image by a quarter. */
export function orientedSize(width: number, height: number, orientation: number): { width: number; height: number } {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

/**
 * Canvas transform (a, b, c, d, e, f for ctx.setTransform) that draws an image stored as
 * width × height so it appears upright. width/height are the stored (unrotated) size.
 */
export function orientationMatrix(orientation: number, width: number, height: number): [number, number, number, number, number, number] {
  switch (orientation) {
    case 2: return [-1, 0, 0, 1, width, 0];
    case 3: return [-1, 0, 0, -1, width, height];
    case 4: return [1, 0, 0, -1, 0, height];
    case 5: return [0, 1, 1, 0, 0, 0];
    case 6: return [0, 1, -1, 0, height, 0];
    case 7: return [0, -1, -1, 0, height, width];
    case 8: return [0, -1, 1, 0, 0, width];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Stored frame size of a JPEG, from the first SOF marker. null when not a JPEG or the SOF is missing or cut off. */
export function readJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return null;
    const marker = bytes[p + 1];
    if (marker === 0xd9 || marker === 0xda) return null;
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if (len < 2) return null;
    if (SOF_MARKERS.has(marker)) {
      if (p + 9 > bytes.length) return null;
      const height = (bytes[p + 5] << 8) | bytes[p + 6];
      const width = (bytes[p + 7] << 8) | bytes[p + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    p += 2 + len;
  }
  return null;
}

/**
 * True when we must rotate the decoded bitmap ourselves: the file asks for a quarter turn (5–8) but the
 * browser handed us the stored, unrotated size, i.e. it did not apply EXIF. Chrome and Edge normally do.
 */
export function needsOwnRotation(
  orientation: number,
  stored: { width: number; height: number } | null,
  decoded: { width: number; height: number },
): boolean {
  if (orientation < 5 || orientation > 8 || !stored) return false;
  return decoded.width === stored.width && decoded.height === stored.height;
}
