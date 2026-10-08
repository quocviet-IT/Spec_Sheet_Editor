import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAlphabet } from "@/lib/ocr/alphabet";

describe("buildAlphabet", () => {
  it("puts the CTC blank first and a space last", () => {
    expect(buildAlphabet("a\nb\n")).toEqual(["blank", "a", "b", " "]);
  });

  it("accepts Windows line endings and a missing final newline", () => {
    expect(buildAlphabet("a\r\nb")).toEqual(["blank", "a", "b", " "]);
  });

  it("gives the v4 model its 6,625 classes", () => {
    const keys = readFileSync(path.join(process.cwd(), "public/models/ppocr-v4/keys.txt"), "utf8");
    const alphabet = buildAlphabet(keys);
    expect(alphabet).toHaveLength(6625);
    for (const c of "0123456789.") expect(alphabet).toContain(c);
  });
});
