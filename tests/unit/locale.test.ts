import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, parseLocale } from "@/messages/locale";

describe("parseLocale", () => {
  it("keeps a supported locale", () => {
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("vi")).toBe("vi");
  });

  it("falls back to Vietnamese for anything else", () => {
    expect(DEFAULT_LOCALE).toBe("vi");
    for (const raw of ["fr", "", undefined, null, 1, "EN"]) expect(parseLocale(raw)).toBe("vi");
  });
});
