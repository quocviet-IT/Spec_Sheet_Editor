import { describe, expect, it } from "vitest";
import { pdfErrorCode } from "@/lib/page/pdf-errors";

describe("pdfErrorCode (TC-17)", () => {
  it("tells a password-protected PDF from a damaged one", () => {
    expect(pdfErrorCode({ name: "PasswordException", message: "No password given" })).toBe("pdf_locked");
    expect(pdfErrorCode({ name: "InvalidPDFException", message: "Invalid PDF structure." })).toBe("pdf_damaged");
    expect(pdfErrorCode(new Error("anything else"))).toBe("pdf_damaged");
    expect(pdfErrorCode(null)).toBe("pdf_damaged");
  });
});
