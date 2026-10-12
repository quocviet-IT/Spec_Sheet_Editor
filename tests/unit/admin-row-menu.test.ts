import { describe, expect, it } from "vitest";
import { initials, menuReaction, nextMenuIndex } from "@/admin/row-menu-keys";

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

describe("menuReaction", () => {
  const vp = { width: 1000, height: 800 };
  const visible = { top: 100, bottom: 132, left: 900, right: 932 };
  it("repositions on a scroll while the button is visible", () => {
    expect(menuReaction("scroll", false, visible, vp)).toBe("reposition");
  });
  it("closes when a scroll takes the button fully off-screen", () => {
    expect(menuReaction("scroll", false, { top: -60, bottom: -28, left: 900, right: 932 }, vp)).toBe("close");
    expect(menuReaction("scroll", false, { top: 800, bottom: 832, left: 900, right: 932 }, vp)).toBe("close");
  });
  it("keeps the menu while the button is partly visible", () => {
    expect(menuReaction("scroll", false, { top: -10, bottom: 22, left: 900, right: 932 }, vp)).toBe("reposition");
  });
  it("ignores a scroll inside the menu itself", () => {
    expect(menuReaction("scroll", true, visible, vp)).toBe("ignore");
    expect(menuReaction("scroll", true, { top: -60, bottom: -28, left: 0, right: 10 }, vp)).toBe("ignore");
  });
  it("repositions on a resize, even when its target is inside the menu", () => {
    expect(menuReaction("resize", false, visible, vp)).toBe("reposition");
    expect(menuReaction("resize", true, visible, vp)).toBe("reposition");
  });
});

describe("initials", () => {
  it("uses the first and last word of the name", () => {
    expect(initials("Ta Quoc Viet", "viet@x.com")).toBe("TV");
  });
  it("falls back to the email name and to a single letter", () => {
    expect(initials(null, "ngoc.dung@x.com")).toBe("ND");
    expect(initials("  ", "viet@x.com")).toBe("V");
    expect(initials("", "")).toBe("?");
  });
});
