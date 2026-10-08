/** BR-05: digits with at most one decimal separator, a point or a comma. */
const NUMBER = /^\d{1,3}(?:[.,]\d{1,3})?$/;

export type ValueError = "format" | "decimals" | "same";

function parse(raw: string): { int: string; frac: string } | null {
  const text = raw.trim();
  if (!NUMBER.test(text)) return null;
  const [int, frac = ""] = text.replace(",", ".").split(".");
  return { int: int.replace(/^0+(?=\d)/, ""), frac };
}

export function decimalsOf(value: string): number {
  const dot = value.indexOf(".");
  return dot < 0 ? 0 : value.length - dot - 1;
}

/** BR-04: the old value the person confirmed, with a point instead of a comma. */
export function normalizeOldValue(raw: string): { ok: true; value: string } | { ok: false; error: "format" } {
  const n = parse(raw);
  if (!n) return { ok: false, error: "format" };
  return { ok: true, value: n.frac ? `${n.int}.${n.frac}` : n.int };
}

/**
 * BR-05 / TC-29: the new value with the old value's number of decimals ("2.6" after "2.50" → "2.60").
 * Extra decimals are accepted only when they are zeros ("2.600" → "2.60"); a real digit is never rounded
 * away, the person is asked for the right precision instead.
 */
export function normalizeNewValue(raw: string, oldValue: string): { ok: true; value: string } | { ok: false; error: ValueError } {
  const n = parse(raw);
  if (!n) return { ok: false, error: "format" };
  const d = decimalsOf(oldValue);
  let frac = n.frac;
  if (frac.length > d) {
    if (/[^0]/.test(frac.slice(d))) return { ok: false, error: "decimals" };
    frac = frac.slice(0, d);
  }
  const value = d > 0 ? `${n.int}.${frac.padEnd(d, "0")}` : n.int;
  if (value === oldValue) return { ok: false, error: "same" };
  return { ok: true, value };
}
