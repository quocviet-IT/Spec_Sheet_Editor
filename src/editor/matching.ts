import type { Detection, Edit } from "./types";

/**
 * UC-05 extension 5a (and the BR-07 check before export): the other values that still show the old
 * value — not yet edited, and read by the machine as exactly that value.
 */
export function matchingValues(detections: readonly Detection[], edits: readonly Edit[], oldValue: string, exceptId: string): Detection[] {
  const edited = new Set(edits.map((e) => e.detectionId));
  return detections.filter((d) => d.id !== exceptId && !edited.has(d.id) && d.readValue === oldValue);
}
