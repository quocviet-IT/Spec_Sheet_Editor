import { describe, expect, it } from "vitest";
import { decimalsOf, normalizeNewValue, normalizeOldValue } from "@/editor/numbers";

describe("normalizeNewValue (BR-05, TC-29)", () => {
  it("rejects anything that is not a number", () => {
    expect(normalizeNewValue("abc", "2.50")).toEqual({ ok: false, error: "format" });
    expect(normalizeNewValue("", "2.50")).toEqual({ ok: false, error: "format" });
    expect(normalizeNewValue("   ", "2.50")).toEqual({ ok: false, error: "format" });
    expect(normalizeNewValue("1.2345", "2.50")).toEqual({ ok: false, error: "format" });
    expect(normalizeNewValue("2.6.1", "2.50")).toEqual({ ok: false, error: "format" });
    expect(normalizeNewValue("-2.6", "2.50")).toEqual({ ok: false, error: "format" });
    expect(normalizeNewValue("1234", "2.50")).toEqual({ ok: false, error: "format" });
  });

  it("turns a comma into a point and takes the old value's decimals", () => {
    expect(normalizeNewValue("2,6", "2.50")).toEqual({ ok: true, value: "2.60" });
    expect(normalizeNewValue("2.6", "2.50")).toEqual({ ok: true, value: "2.60" });
    expect(normalizeNewValue(" 2.6 ", "2.50")).toEqual({ ok: true, value: "2.60" });
    expect(normalizeNewValue("3", "2.50")).toEqual({ ok: true, value: "3.00" });
    expect(normalizeNewValue("16.3", "10.29")).toEqual({ ok: true, value: "16.30" });
    expect(normalizeNewValue("02.6", "2.50")).toEqual({ ok: true, value: "2.60" });
    expect(normalizeNewValue("0.5", "2.50")).toEqual({ ok: true, value: "0.50" });
  });

  it("drops extra zeros but never rounds a real digit away", () => {
    expect(normalizeNewValue("2.600", "2.50")).toEqual({ ok: true, value: "2.60" });
    expect(normalizeNewValue("2.605", "2.50")).toEqual({ ok: false, error: "decimals" });
    expect(normalizeNewValue("2.55", "2.5")).toEqual({ ok: false, error: "decimals" });
  });

  it("refuses a new value equal to the old one", () => {
    expect(normalizeNewValue("2.5", "2.50")).toEqual({ ok: false, error: "same" });
  });
});

describe("normalizeOldValue (BR-04)", () => {
  it("accepts the value the person confirmed, with a point", () => {
    expect(normalizeOldValue("2,50")).toEqual({ ok: true, value: "2.50" });
    expect(normalizeOldValue(" 16.30 ")).toEqual({ ok: true, value: "16.30" });
    expect(normalizeOldValue("007.05")).toEqual({ ok: true, value: "7.05" });
    expect(normalizeOldValue("0.50")).toEqual({ ok: true, value: "0.50" });
  });

  it("rejects anything else", () => {
    expect(normalizeOldValue("")).toEqual({ ok: false, error: "format" });
    expect(normalizeOldValue("2.59?")).toEqual({ ok: false, error: "format" });
  });
});

describe("decimalsOf", () => {
  it("counts the digits after the point", () => {
    expect(decimalsOf("2.50")).toBe(2);
    expect(decimalsOf("2.5")).toBe(1);
    expect(decimalsOf("3")).toBe(0);
  });
});
