import { describe, expect, it } from "vitest";
import { fill } from "@/messages/format";

describe("fill", () => {
  it("replaces named placeholders and leaves unknown ones", () => {
    expect(fill("This file is {n} MB; the limit is {max} MB.", { n: 21, max: 20 })).toBe("This file is 21 MB; the limit is 20 MB.");
    expect(fill("{a} and {b}", { a: "x" })).toBe("x and {b}");
  });
});
