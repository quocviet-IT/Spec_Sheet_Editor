import { describe, expect, it } from "vitest";
import { findLeaks } from "../../scripts/bundle-scan";

describe("findLeaks (TC-77)", () => {
  const needles = [
    { label: "the name SUPABASE_SECRET_KEY", value: "SUPABASE_SECRET_KEY" },
    { label: "the secret key value", value: "sb_secret_example123" },
    { label: "an unset value", value: "" },
  ];
  it("reports each needle found, by label and path", () => {
    const files = [
      { path: "a.js", text: "const k = process.env.SUPABASE_SECRET_KEY" },
      { path: "b.js", text: "x='sb_secret_example123'" },
      { path: "c.js", text: "nothing here" },
    ];
    expect(findLeaks(files, needles)).toEqual([
      { label: "the name SUPABASE_SECRET_KEY", path: "a.js" },
      { label: "the secret key value", path: "b.js" },
    ]);
  });
  it("ignores empty needles, so an unset variable never matches every file", () => {
    expect(findLeaks([{ path: "a.js", text: "" }], needles)).toEqual([]);
  });
});
