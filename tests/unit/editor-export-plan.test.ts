import { describe, expect, it } from "vitest";
import { exportFileName, exportSuggestions, pdfLayout } from "@/editor/export-plan";
import type { Detection, Edit } from "@/editor/types";

describe("exportFileName (TC-46)", () => {
  it("replaces characters file systems refuse", () => {
    expect(exportFileName("Ring 5/6: rev 2", "pdf")).toBe("Ring 5-6- rev 2-edited.pdf");
    expect(exportFileName('a\\b*c?d"e<f>g|h', "png")).toBe("a-b-c-d-e-f-g-h-edited.png");
  });

  it("tidies spaces and trailing dots, and never gives an empty name", () => {
    expect(exportFileName("  Emerald   ring.  ", "png")).toBe("Emerald ring-edited.png");
    expect(exportFileName("tab\there", "pdf")).toBe("tab-here-edited.pdf");
    expect(exportFileName("...", "pdf")).toBe("sheet-edited.pdf");
  });

  it("replaces bidirectional marks and C1 controls, which can hide what a name ends in", () => {
    expect(exportFileName("report‮fdp.exe", "png")).toBe("report-fdp.exe-edited.png");
    expect(exportFileName("a‎b‏c⁦d⁩e", "pdf")).toBe("a-b-c-d-e-edited.pdf");
    expect(exportFileName("x\u0085y\u009Fz", "png")).toBe("x-y-z-edited.png");
  });

  it("keeps the name part to 150 characters, even for the longest name the schema allows", () => {
    const long = exportFileName("n".repeat(200), "pdf");
    expect(long).toBe(`${"n".repeat(150)}-edited.pdf`);
    // A cut that lands on spaces or dots leaves none at the end of the stem.
    expect(exportFileName(`${"n".repeat(148)}. .more`, "png")).toBe(`${"n".repeat(148)}-edited.png`);
  });
});

describe("pdfLayout (UC-09 step 4)", () => {
  const pxPerPt = 300 / 72;

  it("puts an untrimmed PDF page back at its own size", () => {
    expect(pdfLayout(3300, 2550, { kind: "pdf", pageWidthPt: 792, pageHeightPt: 612, pxPerPt, offsetX: 0, offsetY: 0 }))
      .toEqual({ pageWidth: 792, pageHeight: 612, x: 0, y: 0, width: 792, height: 612 });
  });

  it("places a trimmed PDF page where it sat on the original page", () => {
    const l = pdfLayout(3280, 2530, { kind: "pdf", pageWidthPt: 792, pageHeightPt: 612, pxPerPt, offsetX: 10, offsetY: 20 });
    expect(l.pageWidth).toBe(792);
    expect(l.pageHeight).toBe(612);
    expect(l.x).toBeCloseTo(2.4, 6);
    expect(l.width).toBeCloseTo(787.2, 6);
    expect(l.height).toBeCloseTo(607.2, 6);
    expect(l.y).toBeCloseTo(612 - 4.8 - 607.2, 6); // PDF y counts up from the bottom
  });

  it("fits an image on US Letter landscape without distortion, centred", () => {
    const l = pdfLayout(1135, 877, { kind: "image" });
    expect(l.pageWidth).toBe(792);
    expect(l.pageHeight).toBe(612);
    expect(l.width / l.height).toBeCloseTo(1135 / 877, 6);
    expect(Math.min(792 - l.width, 612 - l.height)).toBeCloseTo(0, 6); // touches two sides
    expect(l.x).toBeCloseTo((792 - l.width) / 2, 6);
    expect(l.y).toBeCloseTo((612 - l.height) / 2, 6);
  });
});

describe("exportSuggestions (UC-10 step 2)", () => {
  const box = { cx: 0.2, cy: 0.3, w: 0.02, h: 0.01 };
  const det = (id: string, readValue: string): Detection => ({ id, box, angle: 0, readValue, confidence: 90, source: "ocr" });
  const edit = (detectionId: string, oldValue: string, newValue: string): Edit => ({
    detectionId, oldValue, newValue, box, angle: 0, fontPx: 0.01, textColor: "#676672", bgColor: "#ffffff",
  });

  it("offers each edited old value where it still shows unedited", () => {
    const detections = [det("a", "2.50"), det("b", "2.50"), det("c", "6.90"), det("d", "2.50")];
    const edits = [edit("a", "2.50", "2.60"), edit("d", "2.50", "2.60"), edit("c", "6.90", "7.10")];
    expect(exportSuggestions(detections, edits)).toEqual([{ oldValue: "2.50", newValue: "2.60", ids: ["b"] }]);
  });

  it("uses the first edit's new value when one old value was edited to two different values", () => {
    const detections = [det("a", "2.50"), det("b", "2.50"), det("c", "2.50")];
    const edits = [edit("a", "2.50", "2.60"), edit("b", "2.50", "2.70")];
    expect(exportSuggestions(detections, edits)).toEqual([{ oldValue: "2.50", newValue: "2.60", ids: ["c"] }]);
  });

  it("offers nothing when every match is edited", () => {
    expect(exportSuggestions([det("a", "2.50"), det("b", "2.50")], [edit("a", "2.50", "2.60"), edit("b", "2.50", "2.70")])).toEqual([]);
  });
});
