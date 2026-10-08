import { describe, expect, it } from "vitest";
import { clockTime, defaultSheetName, fileLabel } from "@/sheets/format";

describe("sheet display helpers", () => {
  it("labels the file type and page size", () => {
    expect(fileLabel("png", 1135, 877)).toBe("PNG · 1135 × 877");
    expect(fileLabel("pdf", 3300, 2550)).toBe("PDF · 3300 × 2550");
  });

  it("names a new sheet after its file, without the extension, at most 200 characters", () => {
    expect(defaultSheetName("Emerald ring 3.39ct.pdf", "New sheet")).toBe("Emerald ring 3.39ct");
    expect(defaultSheetName("  .png", "New sheet")).toBe("New sheet");
    expect(defaultSheetName(`${"x".repeat(250)}.jpg`, "New sheet")).toHaveLength(200);
  });
});

describe("clockTime", () => {
  it("shows hours and minutes in the company's time zone (UTC+7)", () => {
    expect(clockTime("2026-10-08T07:05:00Z", "en")).toBe("14:05");
    expect(clockTime("2026-10-08T16:59:00Z", "vi")).toBe("23:59");
  });
});
