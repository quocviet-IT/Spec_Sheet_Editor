import { describe, expect, it } from "vitest";
import { isPointedDimension, readDimension, toDimension, valueReadings } from "@/lib/ocr/dimension-text";
import type { Quad } from "@/lib/ocr/geometry";

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

  it("rejects a leading zero except in 0.xx and before a value written with its point (Ø read as 0)", () => {
    expect(toDimension("0170")).toBeNull();
    expect(toDimension("01.70")).toBe("1.70");
    expect(toDimension("0.50")).toBe("0.50");
    expect(toDimension("050")).toBe("0.50");
    expect(toDimension("000")).toBeNull();
    expect(toDimension("0.00")).toBeNull();
    expect(toDimension("00.50")).toBeNull();
  });
});

describe("readDimension: the value and what is written in front of it", () => {
  it("reads Ø read as a leading 0, and Ø itself", () => {
    expect(readDimension("01.30")).toEqual({ value: "1.30", prefix: "Ø", pointWritten: true });
    expect(readDimension("Ø1.30")).toEqual({ value: "1.30", prefix: "Ø", pointWritten: true });
    expect(readDimension("Ø 1.30")).toEqual({ value: "1.30", prefix: "Ø", pointWritten: true });
    expect(readDimension("010.50")).toEqual({ value: "10.50", prefix: "Ø", pointWritten: true });
  });

  it("reads O, o, Φ, φ, ø and ⌀ directly before a value written with its point as Ø", () => {
    for (const sign of ["O", "o", "Φ", "φ", "ø", "⌀"]) {
      expect(readDimension(`${sign}1.30`), sign).toEqual({ value: "1.30", prefix: "Ø", pointWritten: true });
    }
  });

  it("does not make a diameter out of a look-alike that is not directly before a value with its point", () => {
    expect(readDimension("O 1.30")).toEqual({ value: "1.30", prefix: "", pointWritten: true });
    expect(readDimension("O130")).toEqual({ value: "1.30", prefix: "", pointWritten: false });
    expect(readDimension("O0.50")).toEqual({ value: "0.50", prefix: "", pointWritten: true });
    expect(readDimension("SO1.30")).toEqual({ value: "1.30", prefix: "", pointWritten: true });
  });

  it("takes the value after a count", () => {
    expect(readDimension("2X Ø1.10")).toEqual({ value: "1.10", prefix: "2X Ø", pointWritten: true });
    expect(readDimension("2X01.10")).toEqual({ value: "1.10", prefix: "2X Ø", pointWritten: true });
    expect(readDimension("2x Ø1.10")).toEqual({ value: "1.10", prefix: "2x Ø", pointWritten: true });
    expect(readDimension("(4X) Ø1.10")).toEqual({ value: "1.10", prefix: "(4X) Ø", pointWritten: true });
    expect(readDimension("4X 2.50")).toEqual({ value: "2.50", prefix: "4X ", pointWritten: true });
    expect(readDimension("4XR0.50")).toEqual({ value: "0.50", prefix: "4X R", pointWritten: true });
    expect(readDimension("2×1.10")).toEqual({ value: "1.10", prefix: "2X ", pointWritten: true });
  });

  it("does not take a count before a value whose point was not written, nor other digits in front", () => {
    expect(readDimension("2X 130")).toBeNull();
    expect(readDimension("2X mm1.10")).toBeNull();
    expect(readDimension("12 1.30")).toBeNull();
  });

  it("reads a radius", () => {
    expect(readDimension("R0.50")).toEqual({ value: "0.50", prefix: "R", pointWritten: true });
    expect(readDimension("R 0.50")).toEqual({ value: "0.50", prefix: "R", pointWritten: true });
  });

  it("normalises full-width digits and other decimal points before the rule", () => {
    expect(readDimension("１.５０")?.value).toBe("1.50");
    expect(readDimension("１．５０")?.value).toBe("1.50");
    expect(readDimension("1。50")?.value).toBe("1.50");
    expect(readDimension("1·50")?.value).toBe("1.50");
    expect(readDimension("1，50")?.value).toBe("1.50");
    expect(readDimension("Ø１.３０")).toEqual({ value: "1.30", prefix: "Ø", pointWritten: true });
  });

  it("still holds the value to one or two digits before the point and two after", () => {
    expect(readDimension("Ø1.3")).toBeNull();
    expect(readDimension("Ø123.40")).toBeNull();
    expect(readDimension("2X Ø1.105")).toBeNull();
  });

  it("drops unknown text in front as before, without a prefix", () => {
    expect(readDimension("mm1.30")).toEqual({ value: "1.30", prefix: "", pointWritten: true });
    expect(readDimension("C0.50")).toEqual({ value: "0.50", prefix: "", pointWritten: true });
  });

  it("says whether the point was written or put back by the 3–4-digit repair", () => {
    expect(readDimension("069")).toEqual({ value: "0.69", prefix: "", pointWritten: false });
    expect(readDimension("1630")).toEqual({ value: "16.30", prefix: "", pointWritten: false });
    expect(readDimension("16,30")).toEqual({ value: "16.30", prefix: "", pointWritten: true });
  });
});

describe("isPointedDimension", () => {
  it("is true only for a value whose decimal separator was written", () => {
    expect(isPointedDimension("16.30")).toBe(true);
    expect(isPointedDimension("16,30")).toBe(true);
    expect(isPointedDimension("2X Ø1.10")).toBe(true);
    expect(isPointedDimension("1630")).toBe(false);
    expect(isPointedDimension("069")).toBe(false);
    expect(isPointedDimension("1.5p")).toBe(false);
  });
});

describe("valueReadings: the 3–4-digit repair only where no reading with a written point covers the place", () => {
  const box = (x: number, y: number, w: number, h: number): Quad => [
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
  ];

  it("rejects 069 when a reading with a written point covers the same place", () => {
    const readings = [
      { text: "069", quad: box(100, 100, 40, 14) },
      { text: "6.90", quad: box(98, 99, 44, 16) },
    ];
    expect(valueReadings(readings).map((r) => r.dimension.value)).toEqual(["6.90"]);
  });

  it("keeps a repaired value when no reading with a written point covers its place", () => {
    const readings = [
      { text: "069", quad: box(100, 100, 40, 14) },
      { text: "6.90", quad: box(300, 100, 44, 16) },
      { text: "SO", quad: box(100, 100, 40, 14) },
    ];
    expect(valueReadings(readings).map((r) => r.dimension.value)).toEqual(["0.69", "6.90"]);
  });

  it("keeps two values with their points written at one place for the merge to choose from", () => {
    const readings = [
      { text: "6.90", quad: box(100, 100, 40, 14) },
      { text: "6.98", quad: box(100, 100, 40, 14) },
    ];
    expect(valueReadings(readings)).toHaveLength(2);
  });
});
