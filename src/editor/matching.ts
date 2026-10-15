import type { Detection, Edit } from "./types";

/**
 * UC-05 extension 5a (and the BR-07 check before export): the other values that still show the old
 * value — not yet edited, and read by the machine as exactly that value. Values only: what is written in
 * front of a value (its prefix, "Ø") is not compared, so Ø1.30 and 1.30 match.
 */
export function matchingValues(detections: readonly Detection[], edits: readonly Edit[], oldValue: string, exceptId: string): Detection[] {
  const edited = new Set(edits.map((e) => e.detectionId));
  return detections.filter((d) => d.id !== exceptId && !edited.has(d.id) && d.readValue === oldValue);
}
