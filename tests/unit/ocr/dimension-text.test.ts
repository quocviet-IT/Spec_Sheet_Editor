import { describe, expect, it } from "vitest";
import { toDimension } from "@/lib/ocr/dimension-text";

describe("toDimension (TC-22)", () => {
  it("restores a lost decimal point in 3–4 digit readings", () => {
    expect(toDimension("1630")).toBe("16.30");
    expect(toDimension("170")).toBe("1.70");
  });

  it("keeps readings that already look like a dimension", () => {
    expect(toDimension("2.59")).toBe("2.59");
    expect(toDimension("2,50")).toBe("2.50");
    expect(toDimension("R1.20")).toBe("1.20");
  });

  it("drops anything else", () => {
    expect(toDimension("12345")).toBeNull();
    expect(toDimension("1.2")).toBeNull();
    expect(toDimension("SO")).toBeNull();
    expect(toDimension("")).toBeNull();
  });

  it("trims symbols only at the ends", () => {
    expect(toDimension("16.30mm")).toBe("16.30");
    expect(toDimension("Ø2.50")).toBe("2.50");
    expect(toDimension("16.30.")).toBe("16.30");
  });

  it("drops readings with letters inside instead of guessing", () => {
    expect(toDimension("1l.30")).toBeNull();
    expect(toDimension("1O30")).toBeNull();
    expect(toDimension("16 30")).toBeNull();
  });

  it("rejects a leading zero except in 0.xx", () => {
    expect(toDimension("0170")).toBeNull();
    expect(toDimension("01.70")).toBeNull();
    expect(toDimension("0.50")).toBe("0.50");
    expect(toDimension("050")).toBe("0.50");
    expect(toDimension("000")).toBeNull();
    expect(toDimension("0.00")).toBeNull();
  });
});
