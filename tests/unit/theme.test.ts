import { describe, expect, it } from "vitest";
import { parseTheme } from "@/ui/theme";

describe("parseTheme", () => {
  it("keeps the three known themes", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
  });

  it("falls back to system for anything else", () => {
    expect(parseTheme("Dark")).toBe("system");
    expect(parseTheme("")).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme(42)).toBe("system");
  });
});
