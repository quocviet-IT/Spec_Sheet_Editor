export type PurgeSteps = {
  load(id: string): Promise<{ name: string; paths: string[]; inTrash: boolean } | null>;
  removeFiles(paths: string[]): Promise<boolean>;
  purgeRecord(id: string): Promise<"ok" | "not_in_trash" | "failed">;
};

export type PurgeResult = "ok" | "not_found" | "not_in_trash" | "name_mismatch" | "files_failed" | "failed";

/**
 * UC-17 step 3 (BR-16): only a sheet in the Trash, only with its exact name retyped; the files go first,
 * so a failure there keeps the record (and the sheet in the Trash) and a retry removes whatever remains.
 */
export async function purgeSequence(steps: PurgeSteps, id: string, typedName: string): Promise<PurgeResult> {
  const sheet = await steps.load(id);
  if (!sheet) return "not_found";
  if (!sheet.inTrash) return "not_in_trash";
  if (typedName !== sheet.name) return "name_mismatch";
  if (!(await steps.removeFiles(sheet.paths))) return "files_failed";
  return steps.purgeRecord(id);
}
