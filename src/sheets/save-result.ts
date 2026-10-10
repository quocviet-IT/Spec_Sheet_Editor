import type { SaveResult } from "./types";

/** One row of `save_sheet`. When the save did not happen, `new_version` is the version now stored. */
export type SaveRow = { saved: boolean; new_version: number | null; is_deleted: boolean | null; by_name: string | null; saved_at: string | null };

/**
 * UC-08 / BR-10: what a `save_sheet` row means for the person. A refused save whose stored version is
 * the one that was sent can only be a row-level-security refusal; it is an error, never a conflict.
 */
export function saveResult(row: SaveRow, sentVersion: number): SaveResult {
  if (row.saved) {
    return row.new_version !== null && row.saved_at ? { ok: true, version: row.new_version, savedAt: row.saved_at } : { error: "unknown" };
  }
  if (row.is_deleted) return { error: "trashed" };
  if (row.new_version !== null && row.new_version > sentVersion) return { error: "conflict", byName: row.by_name, savedAt: row.saved_at };
  return { error: "unknown" };
}
