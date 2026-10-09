import { describe, expect, it } from "vitest";
import { matchingValues } from "@/editor/matching";
import type { Detection, Edit } from "@/editor/types";

const box = { cx: 0.2, cy: 0.3, w: 0.02, h: 0.01 };
const det = (id: string, readValue: string | null): Detection => ({ id, box, angle: 0, readValue, confidence: 90, source: "ocr" });
const edit = (detectionId: string): Edit => ({
  detectionId, oldValue: "2.50", newValue: "2.60", box, angle: 0, fontPx: 0.01, textColor: "#676672", bgColor: "#ffffff",
});

describe("matchingValues (UC-05 5a)", () => {
  it("lists other unedited values whose reading equals the confirmed old value", () => {
    const list = [det("a", "2.50"), det("b", "2.50"), det("c", "2.59"), det("d", "2.50"), det("e", null)];
    expect(matchingValues(list, [edit("a"), edit("d")], "2.50", "a").map((d) => d.id)).toEqual(["b"]);
  });

  it("finds nothing when the value appears once", () => {
    expect(matchingValues([det("a", "6.90")], [], "6.90", "a")).toEqual([]);
  });
});
