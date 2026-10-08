import "server-only";
import { cache } from "react";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { SourceType } from "@/lib/form/template";
import { PAGE_SIZE, type Cursor, type SheetPage, type SheetRow, type SheetTab, type UploadSettings } from "./types";

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
 * One page of the list (50 rows) with short-lived thumbnail links (signed_url_ttl_min).
 * A cursor must carry both time and id; the app always sends both (zod), and list_sheets returns no
 * rows for a half cursor.
 */
export async function fetchSheetPage(tab: SheetTab, query: string, after: Cursor | null): Promise<SheetPage> {
  const supabase = await createSupabaseServer();
  const [{ data, error }, cfg] = await Promise.all([
    supabase.rpc("list_sheets", {
      p_trash: tab === "trash",
      p_query: query.trim() || null,
      p_after_time: after?.time ?? null,
      p_after_id: after?.id ?? null,
      p_limit: PAGE_SIZE + 1,
    }),
    settings(),
  ]);
  if (error) throw error;
  const all = (data ?? []) as ListRow[];
  const rows = all.slice(0, PAGE_SIZE);
  const ttl = cfg.signed_url_ttl_min * 60;
  const links = new Map<string, string>();
  if (rows.length > 0) {
    const { data: signed, error: signError } = await supabase.storage.from("spec-sheets").createSignedUrls(rows.map((r) => r.thumb_path), ttl);
    if (signError) console.error("createSignedUrls failed:", signError.message);
    for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) links.set(s.path, s.signedUrl);
  }
  const out: SheetRow[] = rows.map((r) => ({
    id: r.id, name: r.name, sourceType: r.source_type, thumbUrl: links.get(r.thumb_path) ?? null,
    pageW: r.page_px_w, pageH: r.page_px_h, editCount: r.edit_count, version: r.version,
    updatedAt: r.updated_at, updatedByName: r.updated_by_name, deletedAt: r.deleted_at, deletedByName: r.deleted_by_name,
  }));
  const last = rows[rows.length - 1];
  const next = all.length > PAGE_SIZE && last ? { time: (tab === "trash" ? last.deleted_at : last.updated_at) as string, id: last.id } : null;
  return { rows: out, next };
}

export async function fetchCounts(): Promise<{ live: number; trash: number }> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc("sheet_counts");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { live: number | string; trash: number | string } | undefined;
  return { live: Number(row?.live ?? 0), trash: Number(row?.trash ?? 0) };
}

export type SheetDetail = {
  id: string; name: string; sourceType: SourceType; pageW: number; pageH: number; editCount: number;
  deleted: boolean; sourceUrl: string | null;
};

/** One sheet with a short-lived link to its original, or null when it does not exist (or RLS hides it). */
export async function fetchSheet(id: string): Promise<SheetDetail | null> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from("sheet_list")
    .select("id, name, source_type, page_px_w, page_px_h, edit_count, deleted_at")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string; source_type: SourceType; page_px_w: number; page_px_h: number; edit_count: number; deleted_at: string | null }>();
  if (error) throw error;
  if (!data) return null;
  const ttl = (await settings()).signed_url_ttl_min * 60;
  const { data: signed } = await supabase.storage.from("spec-sheets").createSignedUrl(`${id}/source.${data.source_type}`, ttl);
  return {
    id: data.id, name: data.name, sourceType: data.source_type, pageW: data.page_px_w, pageH: data.page_px_h,
    editCount: data.edit_count, deleted: data.deleted_at !== null, sourceUrl: signed?.signedUrl ?? null,
  };
}
