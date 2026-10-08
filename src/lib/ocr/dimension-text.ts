/** One or two digits before the point (no leading zero except "0.xx"), exactly two after. */
const DIMENSION = /^(0|[1-9]\d?)\.\d{2}$/;

/**
 * A machine reading as a dimension value, or null (UC-04 step 4, TC-22). Symbols are trimmed only at the
 * ends ("R1.20", "Ø2.50", "16.30mm"); anything else inside means the reading is not number-shaped, so it
 * is dropped rather than turned into a plausible wrong value. Readings of only 3–4 digits lost their
 * decimal point: "1630" becomes "16.30". The user still confirms every old value (BR-04).
 */
export function toDimension(text: string): string | null {
  const t = text.replace(/^[^0-9]+/, "").replace(/[^0-9]+$/, "").replace(/,/g, ".");
  const value = /^\d{3,4}$/.test(t) ? `${t.slice(0, -2)}.${t.slice(-2)}` : t;
  return DIMENSION.test(value) && Number(value) > 0 ? value : null;
}

/**
 * A dimension written in a PDF's text layer (UC-04 step 2). Symbols are trimmed only at the ends; no
 * decimal point is inserted (that repair is for OCR readings), so an order number never becomes a value.
 */
export function exactDimension(text: string): string | null {
  const t = text.replace(/^[^0-9]+/, "").replace(/[^0-9]+$/, "").replace(/,/g, ".");
  return DIMENSION.test(t) && Number(t) > 0 ? t : null;
}
