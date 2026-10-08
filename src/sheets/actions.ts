"use server";

import { z } from "zod";
import { requireUser } from "@/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { fetchSheetPage } from "./queries";
import type { SheetPage, SheetTab } from "./types";

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
