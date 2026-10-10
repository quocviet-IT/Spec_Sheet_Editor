"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { findOrphans, type StorageFolder } from "@/admin/orphans";
import { purgeSequence, type PurgeResult } from "@/admin/purge";
import { requireAdmin } from "@/auth/session";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

const BUCKET = "spec-sheets";
const PAGE = 1000;
const idSchema = z.uuid();
const typedNameSchema = z.string().max(200);

function has(message: string, word: string): boolean {
  return new RegExp(`(?<![a-z_])${word}(?![a-z_])`).test(message);
}

/**
 * Permanently deletes a sheet that is in the Trash, after its exact name was retyped (UC-17, BR-16).
 * The record is deleted in the Admin's own session (the audit row names the Admin); the secret key
 * only removes the files (NFR-10).
 */
export async function purgeTrashed(input: {
  id: string;
  typedName: string;
}): Promise<{ ok: true; name: string } | { error: Exclude<PurgeResult, "ok"> }> {
  await requireAdmin("/admin/trash");
  const id = idSchema.safeParse(input?.id);
  if (!id.success) return { error: "not_found" };
  const typed = typedNameSchema.safeParse(input?.typedName);
  if (!typed.success) return { error: "name_mismatch" };
  let name = "";
  try {
    const supabase = await createSupabaseServer();
    const result = await purgeSequence(
      {
        async load(sheetId) {
          const { data, error } = await supabase
            .from("spec_sheets")
            .select("name, source_path, thumb_path, deleted_at")
            .eq("id", sheetId)
            .maybeSingle<{ name: string; source_path: string; thumb_path: string; deleted_at: string | null }>();
          if (error) throw error;
          if (!data) return null;
          name = data.name;
          return { name: data.name, paths: [data.source_path, data.thumb_path], inTrash: data.deleted_at !== null };
        },
        async removeFiles(paths) {
          try {
            const { error } = await createSupabaseAdmin().storage.from(BUCKET).remove(paths);
            return !error;
          } catch {
            return false;
          }
        },
        async purgeRecord(sheetId) {
          const { error } = await supabase.rpc("purge_sheet", { p_id: sheetId });
          if (!error) return "ok";
          if (has(error.message, "not_in_trash")) return "not_in_trash";
          return "failed";
        },
      },
      id.data,
      typed.data,
    );
    if (result === "ok" || result === "files_left") revalidatePath("/admin/trash");
    return result === "ok" ? { ok: true, name } : { error: result };
  } catch {
    return { error: "failed" };
  }
}

type Listed = { id: string | null; name: string; created_at?: string | null; metadata?: { size?: number } | null };
type Bucket = ReturnType<ReturnType<typeof createSupabaseAdmin>["storage"]["from"]>;

async function listAll(bucket: Bucket, folder: string): Promise<Listed[]> {
  const all: Listed[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(folder, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    const page = (data ?? []) as Listed[];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

/** Every sheet id, trashed ones included: a trashed sheet's files are not orphans. Read in the Admin's own session (RLS lets the Admin read every sheet). */
async function allSheetIds(): Promise<Set<string>> {
  const supabase = await createSupabaseServer();
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("spec_sheets").select("id").order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { id: string }[];
    for (const r of rows) ids.add(r.id);
    if (rows.length < PAGE) return ids;
  }
}

async function currentOrphans(): Promise<StorageFolder[]> {
  const bucket = createSupabaseAdmin().storage.from(BUCKET);
  const top = await listAll(bucket, "");
  const folders: StorageFolder[] = [];
  for (const entry of top) {
    if (entry.id !== null) continue; // a file at the top level, not a folder
    const files = (await listAll(bucket, entry.name)).filter((f) => f.id !== null);
    let newest = 0;
    let bytes = 0;
    for (const f of files) {
      const at = f.created_at ? new Date(f.created_at).getTime() : Number.NaN;
      if (Number.isFinite(at) && at > newest) newest = at;
      bytes += Number(f.metadata?.size ?? 0) || 0;
    }
    // A folder with no readable time is treated as brand new, so it is never reported.
    folders.push({ name: entry.name, newestAt: new Date(newest || Date.now()).toISOString(), bytes, paths: files.map((f) => `${entry.name}/${f.name}`) });
  }
  return findOrphans(folders, await allSheetIds(), new Date());
}

/** UC-18: lists the storage folders that have no sheet record and are older than 24 hours. */
export async function checkOrphans(): Promise<{ folders: number; bytes: number; names: string[] } | { error: "forbidden" | "unknown" }> {
  await requireAdmin("/admin/trash");
  try {
    const orphans = await currentOrphans();
    return { folders: orphans.length, bytes: orphans.reduce((n, f) => n + f.bytes, 0), names: orphans.map((f) => f.name) };
  } catch {
    return { error: "unknown" };
  }
}

/**
 * Removes the requested orphan folders. The orphans are recomputed now, so a folder that gained a record
 * (or a new file) since the check is left alone. The count is written to the audit log in the Admin's session.
 */
export async function cleanOrphans(input: { names: string[] }): Promise<{ ok: true; folders: number; bytes: number } | { error: "forbidden" | "unknown" }> {
  await requireAdmin("/admin/trash");
  const parsed = z.array(z.string().max(100)).max(100_000).safeParse(input?.names);
  if (!parsed.success) return { error: "unknown" };
  try {
    const wanted = new Set(parsed.data);
    const targets = (await currentOrphans()).filter((f) => wanted.has(f.name));
    const bucket = createSupabaseAdmin().storage.from(BUCKET);
    // Folder by folder: the log must say what was really removed, even when a later folder fails.
    let folders = 0;
    let bytes = 0;
    let failed = false;
    for (const target of targets) {
      if (target.paths.length === 0) continue; // nothing to remove, nothing to count
      let removed = true;
      for (let i = 0; i < target.paths.length; i += 100) {
        const { error } = await bucket.remove(target.paths.slice(i, i + 100));
        if (error) { removed = false; break; }
      }
      if (!removed) { failed = true; break; }
      folders += 1;
      bytes += target.bytes;
    }
    let forbidden = false;
    let logFailed = false;
    if (folders > 0) {
      const supabase = await createSupabaseServer();
      const { error } = await supabase.rpc("log_maintenance", { p_folders: folders, p_bytes: bytes });
      if (error) {
        logFailed = true;
        forbidden = has(error.message, "forbidden");
      }
    }
    if (folders > 0) revalidatePath("/admin/trash");
    if (logFailed) return { error: forbidden ? "forbidden" : "unknown" };
    if (failed) return { error: "unknown" };
    return { ok: true, folders, bytes };
  } catch {
    return { error: "unknown" };
  }
}
