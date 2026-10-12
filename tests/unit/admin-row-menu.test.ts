import { describe, expect, it } from "vitest";
import { nextMenuIndex } from "@/admin/row-menu-keys";

describe("nextMenuIndex", () => {
  it("moves down and wraps from the last item to the first", () => {
    expect(nextMenuIndex(0, 3, "ArrowDown")).toBe(1);
    expect(nextMenuIndex(2, 3, "ArrowDown")).toBe(0);
  });
  it("moves up and wraps from the first item to the last", () => {
    expect(nextMenuIndex(2, 3, "ArrowUp")).toBe(1);
    expect(nextMenuIndex(0, 3, "ArrowUp")).toBe(2);
  });
  it("jumps with Home and End", () => {
    expect(nextMenuIndex(1, 4, "Home")).toBe(0);
    expect(nextMenuIndex(1, 4, "End")).toBe(3);
  });
  it("starts at the first item going down and the last going up when nothing is focused", () => {
    expect(nextMenuIndex(-1, 3, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(-1, 3, "ArrowUp")).toBe(2);
  });
  it("stays put on a single item and ignores other keys and empty menus", () => {
    expect(nextMenuIndex(0, 1, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(0, 1, "ArrowUp")).toBe(0);
    expect(nextMenuIndex(0, 3, "a")).toBeNull();
    expect(nextMenuIndex(0, 3, "Enter")).toBeNull();
    expect(nextMenuIndex(-1, 0, "ArrowDown")).toBeNull();
  });
});
