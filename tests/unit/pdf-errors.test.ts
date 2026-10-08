import { describe, expect, it } from "vitest";
import { pdfErrorCode, pdfScale } from "@/lib/page/pdf-errors";

describe("pdfErrorCode (TC-17)", () => {
  it("tells a password-protected PDF from a damaged one", () => {
    expect(pdfErrorCode({ name: "PasswordException", message: "No password given" })).toBe("pdf_locked");
    expect(pdfErrorCode({ name: "InvalidPDFException", message: "Invalid PDF structure." })).toBe("pdf_damaged");
    expect(pdfErrorCode(new Error("anything else"))).toBe("pdf_damaged");
    expect(pdfErrorCode(null)).toBe("pdf_damaged");
  });
});

describe("pdfScale", () => {
  it("keeps Letter at 300 DPI and caps very large pages at 6600 px wide", () => {
    expect(pdfScale(792)).toBe(300 / 72);
    expect(pdfScale(2592)).toBe(6600 / 2592);
  });
});
