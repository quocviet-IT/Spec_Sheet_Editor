const SHEET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const ORPHAN_MIN_AGE_HOURS = 24;

/** A top-level folder of the `spec-sheets` bucket: its newest object's time, total size and object paths. */
export type StorageFolder = { name: string; newestAt: string; bytes: number; paths: string[] };

/**
 * UC-18 step 2: folders named like a sheet id with no sheet record, whose newest file is at least
 * `minAgeHours` old (an upload in progress writes its files before its record, design 5.3).
 * `recordIds` must hold every sheet id, trashed ones included, or a trashed sheet's files look orphaned.
 */
export function findOrphans(folders: readonly StorageFolder[], recordIds: ReadonlySet<string>, now: Date, minAgeHours = ORPHAN_MIN_AGE_HOURS): StorageFolder[] {
  const cutoff = now.getTime() - minAgeHours * 3_600_000;
  return folders.filter((f) => SHEET_ID.test(f.name) && !recordIds.has(f.name) && new Date(f.newestAt).getTime() <= cutoff);
}
