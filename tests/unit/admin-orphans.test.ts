import { describe, expect, it } from "vitest";
import { findOrphans, formatBytes, type StorageFolder } from "@/admin/orphans";

const NOW = new Date("2026-10-09T12:00:00Z");
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const folder = (name: string, hoursAgo: number): StorageFolder => ({
  name, newestAt: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(), bytes: 1000, paths: [`${name}/source.png`],
});

describe("findOrphans (UC-18, TC-76)", () => {
  it("TC-75 lists folders with no record that are older than 24 hours (what the clean-up removes later)", () => {
    const folders = [folder(ID(1), 30), folder(ID(2), 2), folder(ID(3), 30)];
    expect(findOrphans(folders, new Set([ID(3)]), NOW).map((f) => f.name)).toEqual([ID(1)]);
  });

  it("ignores names that are not sheet ids", () => {
    expect(findOrphans([folder("not-a-sheet", 48), folder(".emptyFolderPlaceholder", 48)], new Set(), NOW)).toEqual([]);
  });

  it("treats exactly 24 hours as old enough", () => {
    expect(findOrphans([folder(ID(4), 24)], new Set(), NOW)).toHaveLength(1);
  });
});

describe("formatBytes", () => {
  it("writes a size a person can read", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2.3 * 1024 * 1024)).toBe("2.3 MB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(formatBytes(1048575)).toBe("1.0 MB");
    expect(formatBytes(1023.96)).toBe("1.0 KB");
  });

  it("treats a bad value as zero", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});
