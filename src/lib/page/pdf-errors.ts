export type PdfError = "pdf_locked" | "pdf_damaged";

/** pdf.js signals a password with PasswordException; anything else that stops loading is "damaged". */
export function pdfErrorCode(error: unknown): PdfError {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  return name === "PasswordException" ? "pdf_locked" : "pdf_damaged";
}
