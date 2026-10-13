import { describe, expect, it } from "vitest";
import { activeTab } from "@/ui/active-tab";

describe("activeTab", () => {
  it.each([
    ["/sheets", "sheets"],
    ["/sheets/6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f", "sheets"],
    ["/guide", "guide"],
    ["/feedback", "feedback"],
    ["/admin", "admin"],
    ["/admin/audit", "admin"],
    ["/account/password", null],
    ["/sheetsx", null],
    ["/", null],
  ])("%s -> %s", (path, tab) => {
    expect(activeTab(path)).toBe(tab);
  });
});
