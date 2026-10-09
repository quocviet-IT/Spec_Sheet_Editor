export type PurgeSteps = {
  load(id: string): Promise<{ name: string; paths: string[]; inTrash: boolean } | null>;
  removeFiles(paths: string[]): Promise<boolean>;
  purgeRecord(id: string): Promise<"ok" | "not_in_trash" | "forbidden" | "failed">;
};

export type PurgeResult = "ok" | "not_found" | "not_in_trash" | "name_mismatch" | "files_left" | "forbidden" | "failed";

/**
 * UC-17 step 3 (BR-16): only a sheet in the Trash, only with its exact name retyped. The record goes first:
 * `purge_sheet` deletes the row only where it is still in the Trash, in one statement, so a restore at the
 * same moment either wins (nothing is deleted) or is refused (the row is gone). Only then are the files
 * removed (two tries); if they stay, the result is `files_left` and the orphan clean-up removes the folder.
 */
export async function purgeSequence(steps: PurgeSteps, id: string, typedName: string): Promise<PurgeResult> {
  try {
    const sheet = await steps.load(id);
    if (!sheet) return "not_found";
    if (!sheet.inTrash) return "not_in_trash";
    if (typedName.normalize("NFC") !== sheet.name.normalize("NFC")) return "name_mismatch";
    const recorded = await steps.purgeRecord(id);
    if (recorded !== "ok") return recorded;
    if (await steps.removeFiles(sheet.paths)) return "ok";
    return (await steps.removeFiles(sheet.paths)) ? "ok" : "files_left";
  } catch {
    return "failed";
  }
}
