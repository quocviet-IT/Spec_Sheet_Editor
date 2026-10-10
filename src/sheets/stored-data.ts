import { sheetDataSchema } from "@/editor/schema";
import type { Detection, Edit } from "@/editor/types";

export type StoredData = { ok: true; detections: Detection[]; edits: Edit[] } | { ok: false; paths: string[] };

/**
 * The stored value list and edits, checked against the schema. One step for the page and for "Load
 * latest version", so unreadable data reads the same in both. Paths only, never values: enough to find
 * the damaged field.
 */
export function readStoredData(detections: unknown, edits: unknown): StoredData {
  const parsed = sheetDataSchema.safeParse({ detections, edits });
  if (parsed.success) return { ok: true, detections: parsed.data.detections, edits: parsed.data.edits };
  return { ok: false, paths: parsed.error.issues.map((issue) => issue.path.join(".") || "(root)").slice(0, 10) };
}
