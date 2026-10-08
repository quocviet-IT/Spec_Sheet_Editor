export type PdfError = "pdf_locked" | "pdf_damaged";

/** pdf.js signals a password with PasswordException; anything else that stops loading is "damaged". */
export function pdfErrorCode(error: unknown): PdfError {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  return name === "PasswordException" ? "pdf_locked" : "pdf_damaged";
}

/** PDF page 1 is drawn at 300 DPI, but never wider than 6600 px (a Letter page: 3300 px). */
export function pdfScale(pageWidthPt: number): number {
  return Math.min(300 / 72, 6600 / pageWidthPt);
}
