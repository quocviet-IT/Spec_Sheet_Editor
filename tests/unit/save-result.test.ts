import { describe, expect, it } from "vitest";
import { saveResult, type SaveRow } from "@/sheets/save-result";

const base: SaveRow = { saved: false, new_version: null, is_deleted: false, by_name: null, saved_at: null };

describe("saveResult", () => {
  it("reports a stored save with its new version and time", () => {
    expect(saveResult({ ...base, saved: true, new_version: 4, saved_at: "2026-01-01T00:00:00Z" }, 3)).toEqual({ ok: true, version: 4, savedAt: "2026-01-01T00:00:00Z" });
  });

  it("treats a saved row without a version or time as an error", () => {
    expect(saveResult({ ...base, saved: true, new_version: null, saved_at: "2026-01-01T00:00:00Z" }, 3)).toEqual({ error: "unknown" });
    expect(saveResult({ ...base, saved: true, new_version: 4, saved_at: null }, 3)).toEqual({ error: "unknown" });
  });

  it("reports a sheet in the Trash, even when its version moved on", () => {
    expect(saveResult({ ...base, is_deleted: true, new_version: 9 }, 3)).toEqual({ error: "trashed" });
    expect(saveResult({ ...base, is_deleted: true, new_version: 3 }, 3)).toEqual({ error: "trashed" });
  });

  it("reports a conflict when a higher version is stored, with who and when", () => {
    expect(saveResult({ ...base, new_version: 5, by_name: "Lan", saved_at: "2026-01-02T00:00:00Z" }, 3)).toEqual({ error: "conflict", byName: "Lan", savedAt: "2026-01-02T00:00:00Z" });
    expect(saveResult({ ...base, new_version: 4 }, 3)).toEqual({ error: "conflict", byName: null, savedAt: null });
  });

  it("reports a refusal at the same version as an error, not a conflict", () => {
    expect(saveResult({ ...base, new_version: 3, by_name: "Lan", saved_at: "2026-01-02T00:00:00Z" }, 3)).toEqual({ error: "unknown" });
  });

  it("reports a refusal with no stored version, or an older one, as an error", () => {
    expect(saveResult(base, 3)).toEqual({ error: "unknown" });
    expect(saveResult({ ...base, new_version: 2 }, 3)).toEqual({ error: "unknown" });
  });
});
