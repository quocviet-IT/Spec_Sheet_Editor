import { overlapShare, SAME_PLACE_OVERLAP, type Quad } from "./geometry";

/** One or two digits before the point (no leading zero except "0.xx"), exactly two after. */
const DIMENSION = /^(0|[1-9]\d?)\.\d{2}$/;
/** A value written with its separator, 1.00–99.99: what a diameter sign read as a look-alike stands before. */
const POINTED_AFTER_SIGN = /^[1-9]\d?[.,]\d{2}$/;
/** What the reader gives for Ø, which its alphabet lacks, when it stands directly before a value with its point. */
const DIAMETER_LOOKALIKES = new Set(["O", "o", "Φ", "φ", "ø", "⌀"]);
/** A count in front of a value: "2X", "2x", "4×", "(4X)". */
const COUNT = /^(?:\(([1-9]\d?)\s*([Xx×])\)|([1-9]\d?)\s*([Xx×]))\s*/;

/**
 * A machine reading as a value. `prefix` is what is written in front of it, normalised ("Ø", "R", "2X Ø",
 * "(4X) Ø", "4X "), "" when there is none; it is drawn again in front of a new value. `pointWritten` is false
 * when the value's decimal point was put back by the 3–4-digit repair.
 */
export type DimensionText = { value: string; prefix: string; pointWritten: boolean };

/** Full-width digits and points as plain ones (NFKC); the CJK and middle points as "."; the full-width comma as ",". */
function normalise(text: string): string {
  return text.normalize("NFKC").replace(/[．。·]/g, ".").replace(/，/g, ",");
}

/** `run` as a value: a comma reads as the point, and only 3–4 digits get a point put back ("1630" → "16.30"). */
function valueOf(run: string, repair: boolean): { value: string; pointWritten: boolean } | null {
  const pointWritten = /[.,]/.test(run);
  const t = run.replace(/,/g, ".");
  const value = !pointWritten && repair && /^\d{3,4}$/.test(t) ? `${t.slice(0, -2)}.${t.slice(-2)}` : t;
  return DIMENSION.test(value) && Number(value) > 0 ? { value, pointWritten } : null;
}

/**
 * A machine reading as a value, or null (UC-04 step 4, TC-22). The reading is normalised first (full-width
 * digits, CJK points). Symbols after the value are trimmed ("16.30mm"). In front of it, a count ("2X") and a
 * diameter (Ø, or a 0, O, o, Φ, φ, ø or ⌀ directly before a value written with its point, as the reader gives
 * Ø) or a radius (R) become the prefix; other symbols are trimmed as before, without a prefix. Anything else
 * inside, or digits in front that are not a count, mean the reading is not number-shaped, so it is dropped
 * rather than turned into a plausible wrong value. Readings of only 3–4 digits lost their decimal point:
 * "1630" becomes "16.30" (not after a count). The user still confirms every old value (BR-04).
 */
export function readDimension(text: string): DimensionText | null {
  const t = normalise(text).replace(/[^0-9]+$/, "");
  const split = /^(.*?)([\d.,]*\d)$/s.exec(t);
  if (!split) return null;
  let run = split[2];
  let rest = split[1].trimStart();
  let count = "";
  const counted = COUNT.exec(rest);
  if (counted) {
    const [, inBrackets, bracketMark, bare, bareMark] = counted;
    const mark = (bracketMark ?? bareMark) === "×" ? "X" : (bracketMark ?? bareMark);
    count = inBrackets !== undefined ? `(${inBrackets}${mark}) ` : `${bare}${mark} `;
    rest = rest.slice(counted[0].length);
  }
  let sign = "";
  if (rest.trim() === "Ø" || rest.trim() === "R") sign = rest.trim();
  else if (DIAMETER_LOOKALIKES.has(rest) && POINTED_AFTER_SIGN.test(run)) sign = "Ø";
  else if (rest === "" && /^0[1-9]\d?[.,]\d{2}$/.test(run)) {
    sign = "Ø";
    run = run.slice(1);
  } else if (rest.trim() !== "") {
    // Unknown symbols in front are trimmed as before; digits there, or after a count, are not a value.
    if (count !== "" || /\d/.test(rest)) return null;
  }
  const value = valueOf(run, count === "");
  if (!value) return null;
  if (count !== "" && !value.pointWritten) return null;
  return { value: value.value, prefix: sign === "" ? count : `${count}${sign}`, pointWritten: value.pointWritten };
}

/** The value of a machine reading, or null (see `readDimension`). */
export function toDimension(text: string): string | null {
  return readDimension(text)?.value ?? null;
}

/** A value whose decimal separator was read, not put back by the 3–4-digit repair. */
export function isPointedDimension(text: string): boolean {
  return readDimension(text)?.pointWritten === true;
}

/**
 * UC-04 step 4 and UC-06: the readings that are values. A value only repaired from 3–4 digits is dropped
 * where a reading with its point written covers the same place (their quads share at least half of the
 * smaller one): "069" there is the upside-down or partial reading of that value, not a value of its own.
 */
export function valueReadings<T extends { text: string; quad: Quad }>(readings: readonly T[]): { reading: T; dimension: DimensionText }[] {
  const values = readings.flatMap((reading) => {
    const dimension = readDimension(reading.text);
    return dimension ? [{ reading, dimension }] : [];
  });
  const pointed = values.filter((v) => v.dimension.pointWritten);
  return values.filter((v) => v.dimension.pointWritten || !pointed.some((p) => overlapShare(p.reading.quad, v.reading.quad) >= SAME_PLACE_OVERLAP));
}

/** Drops everything but digits at both ends and reads a comma as the decimal point. */
function trimSymbols(text: string): string {
  return text.replace(/^[^0-9]+/, "").replace(/[^0-9]+$/, "").replace(/,/g, ".");
}

/**
 * A dimension written in a PDF's text layer (UC-04 step 2). Symbols are trimmed only at the ends; no
 * decimal point is inserted (that repair is for OCR readings), so an order number never becomes a value.
 */
export function exactDimension(text: string): string | null {
  const t = trimSymbols(text);
  return DIMENSION.test(t) && Number(t) > 0 ? t : null;
}
