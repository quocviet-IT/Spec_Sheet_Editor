import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { admin } from "./db";

/** Where global setup keeps the shared settings while a run is going (the folder is git-ignored). */
export const SETTINGS_SNAPSHOT = "e2e/.auth/settings-snapshot.json";

type Row = { key: string; value: number };

async function readAll(): Promise<Row[]> {
  const { data, error } = await admin().from("app_settings").select("key, value");
  if (error) throw new Error(`settings not read: ${error.message}`);
  return data.map((r) => ({ key: r.key as string, value: Number(r.value) }));
}

async function writeBack(rows: Row[]): Promise<void> {
  for (const r of rows) {
    const { error } = await admin().from("app_settings").update({ value: r.value }).eq("key", r.key);
    if (error) throw new Error(`setting ${r.key} not restored: ${error.message}`);
  }
}

/**
 * Called by global setup before anything runs. A snapshot still on disk means a run was killed before its
 * teardown, so those values are the real ones: they are written back first, then the snapshot is taken again.
 */
export async function snapshotSettings(): Promise<void> {
  await mkdir("e2e/.auth", { recursive: true });
  if (existsSync(SETTINGS_SNAPSHOT)) await restoreSettingsSnapshot();
  await writeFile(SETTINGS_SNAPSHOT, JSON.stringify(await readAll()), "utf8");
}

/** Called by global teardown: writes the snapshot back and deletes the file. A missing file means nothing to restore. */
export async function restoreSettingsSnapshot(): Promise<void> {
  if (!existsSync(SETTINGS_SNAPSHOT)) return;
  const rows = JSON.parse(await readFile(SETTINGS_SNAPSHOT, "utf8")) as Row[];
  await writeBack(rows);
  await rm(SETTINGS_SNAPSHOT);
}
