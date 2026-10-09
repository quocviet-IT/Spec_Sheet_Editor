import { describe, expect, it } from "vitest";
import { MAX_VALUES, saveInputSchema, sheetDataSchema } from "@/editor/schema";

const box = { cx: 0.2, cy: 0.3, w: 0.02, h: 0.01 };
const det = (id: string, over: Record<string, unknown> = {}) => ({ id, box, angle: -90, readValue: "2.50", confidence: 87, source: "ocr", ...over });
const edit = (detectionId: string, over: Record<string, unknown> = {}) => ({
  detectionId, oldValue: "2.50", newValue: "2.60", box, angle: -90, fontPx: 0.01, textColor: "#676672", bgColor: "#ffffff", ...over,
});
const ok = (data: unknown) => sheetDataSchema.safeParse(data).success;

describe("sheetDataSchema", () => {
  it("accepts detections and edits as the editor stores them", () => {
    expect(ok({ detections: [det("a"), det("b", { source: "pdf-text", confidence: null })], edits: [edit("a")] })).toBe(true);
    expect(ok({ detections: [], edits: [] })).toBe(true);
  });

  it("accepts a value without a machine reading (a box drawn by hand)", () => {
    expect(ok({ detections: [det("a", { readValue: null, confidence: null, source: "manual" })], edits: [] })).toBe(true);
  });

  it("refuses an edit of a value that is not in the list", () => {
    expect(ok({ detections: [det("a")], edits: [edit("b")] })).toBe(false);
  });

  it("refuses two values with one id and two edits of one value", () => {
    expect(ok({ detections: [det("a"), det("a")], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a")], edits: [edit("a"), edit("a", { newValue: "2.70" })] })).toBe(false);
  });

  it("refuses values that are not normalised", () => {
    expect(ok({ detections: [det("a")], edits: [edit("a", { newValue: "2,60" })] })).toBe(false);
    expect(ok({ detections: [det("a")], edits: [edit("a", { oldValue: "" })] })).toBe(false);
    expect(ok({ detections: [det("a", { readValue: "abc" })], edits: [] })).toBe(false);
  });

  it("refuses boxes off the page, empty boxes, odd angles and colours", () => {
    expect(ok({ detections: [det("a", { box: { ...box, cx: 1.2 } })], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a", { box: { ...box, w: 0 } })], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a", { angle: -180 })], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a")], edits: [edit("a", { textColor: "red" })] })).toBe(false);
    expect(ok({ detections: [det("a")], edits: [edit("a", { bgColor: "#FFFFFF" })] })).toBe(false);
  });

  it("holds confidence to 0–100", () => {
    expect(ok({ detections: [det("a", { confidence: -1 })], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a", { confidence: 100.5 })], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a", { confidence: 101 })], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a", { confidence: 0 })], edits: [] })).toBe(true);
    expect(ok({ detections: [det("a", { confidence: 100 })], edits: [] })).toBe(true);
  });

  it("holds ids to 64 characters", () => {
    expect(ok({ detections: [det("x".repeat(64))], edits: [edit("x".repeat(64))] })).toBe(true);
    expect(ok({ detections: [det("x".repeat(65))], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a")], edits: [edit("x".repeat(65))] })).toBe(false);
    expect(ok({ detections: [det("")], edits: [] })).toBe(false);
  });

  it("refuses a read value or a box of the wrong type", () => {
    expect(ok({ detections: [det("a", { readValue: ["2.50"] })], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a", { readValue: 2.5 })], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a", { box: "0.2,0.3,0.02,0.01" })], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a", { box: [0.2, 0.3, 0.02, 0.01] })], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a")], edits: [edit("a", { box: "x" })] })).toBe(false);
    expect(ok({ detections: [det("a")], edits: [edit("a", { box: [0.2, 0.3, 0.02, 0.01] })] })).toBe(false);
  });

  it("holds the digit height to a fraction of the page width above 0", () => {
    expect(ok({ detections: [det("a")], edits: [edit("a", { fontPx: 0 })] })).toBe(false);
    expect(ok({ detections: [det("a")], edits: [edit("a", { fontPx: -0.01 })] })).toBe(false);
    expect(ok({ detections: [det("a")], edits: [edit("a", { fontPx: 1.01 })] })).toBe(false);
    expect(ok({ detections: [det("a")], edits: [edit("a", { fontPx: "0.01" })] })).toBe(false);
    expect(ok({ detections: [det("a")], edits: [edit("a", { fontPx: 1 })] })).toBe(true);
  });

  it("refuses fields it does not know", () => {
    expect(ok({ detections: [det("a", { note: "x" })], edits: [] })).toBe(false);
    expect(ok({ detections: [det("a")], edits: [edit("a", { extra: 1 })] })).toBe(false);
  });

  it("caps the number of values", () => {
    const many = Array.from({ length: MAX_VALUES + 1 }, (_, i) => det(`d${i}`));
    expect(ok({ detections: many, edits: [] })).toBe(false);
    expect(ok({ detections: many.slice(0, MAX_VALUES), edits: [] })).toBe(true);
  });
});

describe("saveInputSchema", () => {
  it("needs a sheet id and a version from 1", () => {
    const data = { detections: [], edits: [] };
    expect(saveInputSchema.safeParse({ id: "8f0f8a52-4b6e-4f5e-9d55-7d1f3c2a9b10", version: 1, name: "Sheet", data }).success).toBe(true);
    expect(saveInputSchema.safeParse({ id: "not-a-uuid", version: 1, name: "Sheet", data }).success).toBe(false);
    expect(saveInputSchema.safeParse({ id: "8f0f8a52-4b6e-4f5e-9d55-7d1f3c2a9b10", version: 0, name: "Sheet", data }).success).toBe(false);
    expect(saveInputSchema.safeParse({ id: "8f0f8a52-4b6e-4f5e-9d55-7d1f3c2a9b10", version: 1.5, name: "Sheet", data }).success).toBe(false);
    expect(saveInputSchema.safeParse({ id: "8f0f8a52-4b6e-4f5e-9d55-7d1f3c2a9b10", version: 2147483648, name: "Sheet", data }).success).toBe(false);
  });
  it("needs a name of 1 to 200 characters, trimmed", () => {
    const base = { id: "8f0f8a52-4b6e-4f5e-9d55-7d1f3c2a9b10", version: 1, data: { detections: [], edits: [] } };
    const parsed = saveInputSchema.safeParse({ ...base, name: "  Emerald ring  " });
    expect(parsed.success && parsed.data.name).toBe("Emerald ring");
    expect(saveInputSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
    expect(saveInputSchema.safeParse({ ...base, name: "x".repeat(201) }).success).toBe(false);
    expect(saveInputSchema.safeParse(base).success).toBe(false);
  });
});
