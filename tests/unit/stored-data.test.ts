import { describe, expect, it } from "vitest";
import { readStoredData } from "@/sheets/stored-data";

const detection = { id: "d1", box: { cx: 0.5, cy: 0.5, w: 0.1, h: 0.05 }, angle: 0, readValue: "6.90", confidence: 90, source: "ocr" };

describe("readStoredData", () => {
  it("returns the lists when they match the schema", () => {
    expect(readStoredData([detection], [])).toEqual({ ok: true, detections: [detection], edits: [] });
    expect(readStoredData([], [])).toEqual({ ok: true, detections: [], edits: [] });
  });

  it("reports broken data with the damaged paths and no values", () => {
    const result = readStoredData([{ ...detection, readValue: "secret-text" }], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.paths).toEqual(["detections.0.readValue"]);
      expect(JSON.stringify(result)).not.toContain("secret-text");
    }
  });

  it("reports data that is not lists at all", () => {
    expect(readStoredData(null, "x").ok).toBe(false);
  });

  it("reports an edit that points at no listed value", () => {
    const edit = { detectionId: "nope", oldValue: "6.90", newValue: "7.10", box: detection.box, angle: 0, fontPx: 0.02, textColor: "#000000", bgColor: "#ffffff" };
    expect(readStoredData([detection], [edit]).ok).toBe(false);
  });
});
