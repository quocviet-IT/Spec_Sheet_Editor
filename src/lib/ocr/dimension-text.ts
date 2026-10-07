const DIMENSION = /^\d{1,2}\.\d{2}$/;

/**
 * A machine reading as a dimension value, or null (UC-04 step 4, TC-22). Readings of only 3–4 digits
 * lost their decimal point: "1630" becomes "16.30". The user still confirms every old value (BR-04).
 */
export function toDimension(text: string): string | null {
  let t = text.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  if (/^\d{3,4}$/.test(t)) t = `${t.slice(0, -2)}.${t.slice(-2)}`;
  return DIMENSION.test(t) ? t : null;
}
