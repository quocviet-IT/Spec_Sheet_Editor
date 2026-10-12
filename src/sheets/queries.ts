import "server-only";
import { cache } from "react";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { SourceType } from "@/lib/form/template";
import { pageRead } from "@/admin/paging";
import { nameContainsPattern } from "./list-url";
import { readStoredData } from "./stored-data";
import { type EditorSheet, type SheetRow, type SheetTab, type UploadSettings } from "./types";

type ListRow = {
  id: string; name: string; source_type: SourceType; thumb_path: string; page_px_w: number; page_px_h: number;
  edit_count: number; version: number; updated_at: string; updated_by_name: string;
  deleted_at: string | null; deleted_by_name: string | null;
};

const SETTING_DEFAULTS = { max_file_mb: 20, lowres_warn_px: 2000, aspect_tolerance_pct: 2, signed_url_ttl_min: 10 };

const settings = cache(async (): Promise<typeof SETTING_DEFAULTS> => {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.from("app_settings").select("key, value");
  if (error) throw error;
  const out = { ...SETTING_DEFAULTS };
  for (const row of (data ?? []) as { key: keyof typeof SETTING_DEFAULTS; value: number }[]) {
    if (!(row.key in out)) continue;
    const n = Number(row.value);
    if (Number.isFinite(n)) out[row.key] = n;
  }
  return out;
});

export async function fetchUploadSettings(): Promise<UploadSettings> {
  const s = await settings();
  return { maxFileMb: s.max_file_mb, lowresWarnPx: s.lowres_warn_px, aspectTolerancePct: s.aspect_tolerance_pct };
}

/**
 * One numbered page of the list with short-lived thumbnail links (signed_url_ttl_min). Count first, then read
 * one range: a range that starts past the end, read together with an exact count, is refused by PostgREST (416),
 * and the count also lets a page number past the end land on the last page. The order is the one of list_sheets:
 * last change (live) or deletion time (Trash), newest first, then id.
 */
export async function fetchSheetPageNumbered(
  tab: SheetTab, query: string, page: number, size: number,
): Promise<{ rows: SheetRow[]; total: number; page: number }> {
  const supabase = await createSupabaseServer();
  const trash = tab === "trash";
  const pattern = nameContainsPattern(query);
  let counting = supabase.from("sheet_list").select("id", { count: "exact", head: true });
  counting = trash ? counting.not("deleted_at", "is", null) : counting.is("deleted_at", null);
  if (pattern) counting = counting.filter("name", "imatch", pattern);
  const [{ count, error: countError }, cfg] = await Promise.all([counting, settings()]);
  if (countError) throw countError;
  const total = count ?? 0;
  const plan = pageRead(total, page, size);
  if (!plan) return { rows: [], total, page: 1 };
  let reading = supabase
    .from("sheet_list")
    .select("id, name, source_type, thumb_path, page_px_w, page_px_h, edit_count, version, updated_at, updated_by_name, deleted_at, deleted_by_name");
  reading = trash ? reading.not("deleted_at", "is", null) : reading.is("deleted_at", null);
  if (pattern) reading = reading.filter("name", "imatch", pattern);
  const { data, error } = await reading
    .order(trash ? "deleted_at" : "updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(plan.from, plan.to);
  if (error) throw error;
  const found = (data ?? []) as unknown as ListRow[];
  const links = new Map<string, string>();
  if (found.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from("spec-sheets")
      .createSignedUrls(found.map((r) => r.thumb_path), cfg.signed_url_ttl_min * 60);
    if (signError) console.error("createSignedUrls failed:", signError.message);
    for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) links.set(s.path, s.signedUrl);
  }
  const rows: SheetRow[] = found.map((r) => ({
    id: r.id, name: r.name, sourceType: r.source_type, thumbUrl: links.get(r.thumb_path) ?? null,
    pageW: r.page_px_w, pageH: r.page_px_h, editCount: r.edit_count, version: r.version,
    updatedAt: r.updated_at, updatedByName: r.updated_by_name, deletedAt: r.deleted_at, deletedByName: r.deleted_by_name,
  }));
  return { rows, total, page: plan.page };
}

export async function fetchCounts(): Promise<{ live: number; trash: number }> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("sheet_counts");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { live: number | string; trash: number | string } | undefined;
  return { live: Number(row?.live ?? 0), trash: Number(row?.trash ?? 0) };
}

type EditorRow = {
  id: string; name: string; source_type: SourceType; page_px_w: number; page_px_h: number; version: number;
  detections: unknown; edits: unknown; deleted_at: string | null;
};

/** One sheet for the editor with a short-lived link to its original, or null when it does not exist (or RLS hides it). */
export async function fetchEditorSheet(id: string): Promise<EditorSheet | null> {
  const supabase = await createSupabaseServer();
  const [{ data, error }, cfg] = await Promise.all([
    supabase
      .from("spec_sheets")
      .select("id, name, source_type, page_px_w, page_px_h, version, detections, edits, deleted_at")
      .eq("id", id)
      .maybeSingle<EditorRow>(),
    settings(),
  ]);
  if (error) throw error;
  if (!data) return null;
  const stored = readStoredData(data.detections, data.edits);
  if (!stored.ok) console.error(`Sheet ${id}: stored detections or edits do not match the schema at ${stored.paths.join(", ")}`);
  const { data: signed } = await supabase.storage
    .from("spec-sheets")
    .createSignedUrl(`${id}/source.${data.source_type}`, cfg.signed_url_ttl_min * 60);
  return {
    id: data.id, name: data.name, sourceType: data.source_type, pageW: data.page_px_w, pageH: data.page_px_h,
    version: data.version,
    detections: stored.ok ? stored.detections : [],
    edits: stored.ok ? stored.edits : [],
    deleted: data.deleted_at !== null,
    broken: !stored.ok,
    sourceUrl: signed?.signedUrl ?? null,
    lowRes: data.page_px_w < cfg.lowres_warn_px,
  };
}
