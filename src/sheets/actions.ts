"use server";

import { z } from "zod";
import { requireUser } from "@/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { fetchSheetPage } from "./queries";
import { saveInputSchema } from "@/editor/schema";
import type { Detection, Edit } from "@/editor/types";
import { saveResult, type SaveRow } from "./save-result";
import { readStoredData } from "./stored-data";
import type { EditorState, SaveResult, SheetPage, SheetTab } from "./types";

const loadInput = z.object({
  tab: z.enum(["live", "trash"]),
  query: z.string().max(200),
  after: z.object({ time: z.string().min(1).max(64), id: z.uuid() }).nullable(),
});

/** The next 50 rows, or a fresh first page after a tab or search change (UC-02 steps 2–3). */
export async function loadSheets(input: { tab: SheetTab; query: string; after: { time: string; id: string } | null }): Promise<SheetPage | { error: "unknown" }> {
  await requireUser("/sheets");
  const parsed = loadInput.safeParse(input);
  if (!parsed.success) return { error: "unknown" };
  try {
    return await fetchSheetPage(parsed.data.tab, parsed.data.query, parsed.data.after);
  } catch (error) {
    console.error("loadSheets failed:", error instanceof Error ? error.message : error);
    return { error: "unknown" };
  }
}

type Result = { ok: true } | { error: "unknown" };

/** UC-11: the database sets deleted_at / deleted_by and writes sheet.trash. */
export async function trashSheet(id: string): Promise<Result> {
  const me = await requireUser("/sheets");
  if (!z.uuid().safeParse(id).success) return { error: "unknown" };
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from("spec_sheets")
    .update({ deleted_at: new Date().toISOString(), updated_by: me.id })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error || !data || data.length !== 1) return { error: "unknown" };
  return { ok: true };
}

/** UC-11: back from the Trash; the database writes sheet.restore. */
export async function restoreSheet(id: string): Promise<Result> {
  const me = await requireUser("/sheets");
  if (!z.uuid().safeParse(id).success) return { error: "unknown" };
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from("spec_sheets")
    .update({ deleted_at: null, updated_by: me.id })
    .eq("id", id)
    .not("deleted_at", "is", null)
    .select("id");
  if (error || !data || data.length !== 1) return { error: "unknown" };
  return { ok: true };
}

const createInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  sourceType: z.enum(["pdf", "png", "jpg"]),
  pageW: z.number().int().positive().max(20000),
  pageH: z.number().int().positive().max(20000),
});

/**
 * UC-03 step 6 / section 5.3 step 5: the browser has uploaded both files; check they are there, then
 * create the row in the person's own session (RLS insert policy; the trigger writes sheet.upload).
 */
export async function createSheet(input: { id: string; name: string; sourceType: string; pageW: number; pageH: number }): Promise<{ ok: true; id: string } | { error: "invalid" | "files_missing" | "unknown" }> {
  const me = await requireUser("/sheets");
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { id, name, sourceType, pageW, pageH } = parsed.data;
  const supabase = await createSupabaseServer();
  const { data: files, error: listError } = await supabase.storage.from("spec-sheets").list(id);
  if (listError) return { error: "unknown" };
  const names = new Set((files ?? []).map((f) => f.name));
  if (!names.has(`source.${sourceType}`) || !names.has("thumb.jpg")) return { error: "files_missing" };
  const { error } = await supabase.from("spec_sheets").insert({
    id, name, source_type: sourceType, source_path: `${id}/source.${sourceType}`, thumb_path: `${id}/thumb.jpg`,
    page_px_w: pageW, page_px_h: pageH, created_by: me.id, updated_by: me.id,
  });
  if (error) {
    console.error("createSheet insert failed:", error.message);
    return { error: "unknown" };
  }
  return { ok: true, id };
}

/**
 * UC-08: store the value list and the edits when the version still matches (BR-10). The name travels with
 * every save (the trigger logs sheet.save only when it changed). A sheet in the Trash or saved by someone else in the meantime is
 * reported, never overwritten.
 */
export async function saveSheet(input: { id: string; version: number; name: string; detections: Detection[]; edits: Edit[] }): Promise<SaveResult> {
  await requireUser("/sheets");
  const parsed = saveInputSchema.safeParse({
    id: input?.id, version: input?.version, name: input?.name, data: { detections: input?.detections, edits: input?.edits },
  });
  if (!parsed.success) return { error: "invalid" };
  const { id, version, name, data } = parsed.data;
  const supabase = await createSupabaseServer();
  const { data: rows, error } = await supabase.rpc("save_sheet", {
    p_id: id, p_version: version, p_name: name, p_detections: data.detections, p_edits: data.edits,
  });
  if (error) {
    console.error("saveSheet failed:", error.message);
    return { error: "unknown" };
  }
  const row = (Array.isArray(rows) ? rows[0] : rows) as SaveRow | undefined;
  if (!row) return { error: "unknown" }; // the sheet is gone or hidden
  return saveResult(row, version);
}

/** UC-08 extension 3a, "Load latest version": the stored lists and version. */
export async function loadEditorState(id: string): Promise<EditorState | { error: "gone" | "broken" | "unknown" }> {
  await requireUser("/sheets");
  if (!z.uuid().safeParse(id).success) return { error: "gone" };
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from("spec_sheets")
    .select("version, name, detections, edits, deleted_at")
    .eq("id", id)
    .maybeSingle<{ version: number; name: string; detections: unknown; edits: unknown; deleted_at: string | null }>();
  if (error) {
    console.error("loadEditorState failed:", error.message);
    return { error: "unknown" };
  }
  if (!data) return { error: "gone" };
  const stored = readStoredData(data.detections, data.edits);
  if (!stored.ok) {
    console.error(`Sheet ${id}: stored detections or edits do not match the schema at ${stored.paths.join(", ")}`);
    return { error: "broken" };
  }
  return { version: data.version, name: data.name, detections: stored.detections, edits: stored.edits, deleted: data.deleted_at !== null };
}

const exportInput = z.object({
  id: z.uuid(),
  format: z.enum(["png", "pdf"]),
  edits: z.number().int().min(0).max(300),
  unsaved: z.boolean(),
});

/** UC-09 postcondition: `sheet.export_png` / `sheet.export_pdf` in the audit log (`log_client_event`). */
export async function logExport(input: { id: string; format: "png" | "pdf"; edits: number; unsaved: boolean }): Promise<{ ok: true } | { error: "invalid" | "unknown" }> {
  await requireUser("/sheets");
  const parsed = exportInput.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { id, format, edits, unsaved } = parsed.data;
  const supabase = await createSupabaseServer();
  const { error } = await supabase.rpc("log_client_event", {
    p_action: format === "png" ? "sheet.export_png" : "sheet.export_pdf",
    p_target_id: id,
    p_detail: { edits, unsaved },
  });
  if (error) {
    console.error("logExport failed:", error.message);
    return { error: "unknown" };
  }
  return { ok: true };
}
