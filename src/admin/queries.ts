import "server-only";
import { createSupabaseServer } from "@/lib/supabase/server";
import { auditRange, groupPrefix, type AuditFilter } from "./audit-filter";
import type { SettingKey } from "./settings-ranges";

export type UserRow = {
  id: string;
  email: string;
  fullName: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  passwordAccount: boolean;
  mustChangePassword: boolean;
  lastSeenAt: string | null;
  sheets: number;
};

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  password_account: boolean;
  must_change_password: boolean;
  last_seen_at: string | null;
};

const PAGE = 1000; // PostgREST caps a read at 1000 rows

type Supabase = Awaited<ReturnType<typeof createSupabaseServer>>;

async function fetchProfiles(supabase: Supabase): Promise<ProfileRow[]> {
  const all: ProfileRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, status, password_account, must_change_password, last_seen_at")
      .order("email")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as ProfileRow[];
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}

/** Sheets per creator in one pass. Trashed sheets count as created: the column answers "how many did this account make". */
async function fetchSheetCounts(supabase: Supabase): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("spec_sheets")
      .select("created_by")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { created_by: string }[];
    for (const r of rows) counts.set(r.created_by, (counts.get(r.created_by) ?? 0) + 1);
    if (rows.length < PAGE) return counts;
  }
}

/** Every account with the number of sheets it created; the Admin may read every profile and sheet. */
export async function fetchUsers(): Promise<UserRow[]> {
  const supabase = await createSupabaseServer();
  const [profiles, counts] = await Promise.all([fetchProfiles(supabase), fetchSheetCounts(supabase)]);
  return profiles.map((p) => ({
    id: p.id,
    email: p.email,
    fullName: p.full_name,
    role: p.role,
    status: p.status,
    passwordAccount: p.password_account,
    mustChangePassword: p.must_change_password,
    lastSeenAt: p.last_seen_at,
    sheets: counts.get(p.id) ?? 0,
  }));
}

/** `accounts`: Google accounts the entry admits; `loseAccess`: those admitted by this entry and no other. */
export type AccessEntry = { value: string; note: string | null; accounts: number; loseAccess: number };

type AllowedRow = { value: string; note: string | null };

async function fetchAllowed(supabase: Supabase, table: "allowed_domains" | "allowed_emails", column: "domain" | "email"): Promise<AllowedRow[]> {
  const all: AllowedRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(`${column}, note`)
      .order(column)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = ((data ?? []) as unknown as Record<string, string | null>[]).map((r) => ({
      value: String(r[column]),
      note: r.note ?? null,
    }));
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}

/** The permitted domains and emails, each with the Google accounts it admits (case-insensitive). */
export async function fetchAccess(): Promise<{ domains: AccessEntry[]; emails: AccessEntry[] }> {
  const supabase = await createSupabaseServer();
  const [domains, emails, profiles] = await Promise.all([
    fetchAllowed(supabase, "allowed_domains", "domain"),
    fetchAllowed(supabase, "allowed_emails", "email"),
    fetchProfiles(supabase),
  ]);
  // The lists gate Google sign-ins only; password accounts an Admin created are always admitted.
  const google = profiles.filter((p) => !p.password_account).map((p) => p.email.toLowerCase());
  const domainSet = new Set(domains.map((d) => d.value.toLowerCase()));
  const emailSet = new Set(emails.map((d) => d.value.toLowerCase()));
  const domainOf = (e: string) => e.slice(e.lastIndexOf("@") + 1);
  const byDomain = new Map<string, { accounts: number; loseAccess: number }>();
  const byEmail = new Map<string, { accounts: number; loseAccess: number }>();
  const bump = (m: Map<string, { accounts: number; loseAccess: number }>, key: string, only: boolean) => {
    const c = m.get(key) ?? { accounts: 0, loseAccess: 0 };
    c.accounts += 1;
    if (only) c.loseAccess += 1;
    m.set(key, c);
  };
  for (const e of google) {
    const d = domainOf(e);
    // An account loses access only when this entry is the one entry that admits it.
    if (domainSet.has(d)) bump(byDomain, d, !emailSet.has(e));
    if (emailSet.has(e)) bump(byEmail, e, !domainSet.has(d));
  }
  const none = { accounts: 0, loseAccess: 0 };
  return {
    domains: domains.map((d) => ({ ...d, ...(byDomain.get(d.value.toLowerCase()) ?? none) })),
    emails: emails.map((d) => ({ ...d, ...(byEmail.get(d.value.toLowerCase()) ?? none) })),
  };
}

const SETTING_DEFAULTS: Record<SettingKey, number> = { max_file_mb: 20, lowres_warn_px: 2000, aspect_tolerance_pct: 2, signed_url_ttl_min: 10 };

/** The four system settings as stored (defaults fill a missing row). */
export async function fetchSettings(): Promise<Record<SettingKey, number>> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.from("app_settings").select("key, value");
  if (error) throw error;
  const out = { ...SETTING_DEFAULTS };
  for (const row of (data ?? []) as { key: SettingKey; value: number }[]) {
    if (!(row.key in out)) continue;
    const n = Number(row.value);
    if (Number.isFinite(n)) out[row.key] = n;
  }
  return out;
}

export const AUDIT_PAGE = 100;
export const AUDIT_CSV_MAX = 50_000;

export type AuditRow = {
  id: number;
  occurredAt: string;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
};

type AuditDbRow = {
  id: number;
  occurred_at: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: unknown;
};

const AUDIT_COLUMNS = "id, occurred_at, actor_email, action, target_type, target_id, detail";

function toAuditRow(r: AuditDbRow): AuditRow {
  return { id: r.id, occurredAt: r.occurred_at, actorEmail: r.actor_email, action: r.action, targetType: r.target_type, targetId: r.target_id, detail: r.detail };
}

/** The filter as plain column values; each query applies them itself so the builder types stay shallow. */
function auditParams(filter: AuditFilter) {
  const { fromIso, toIsoExclusive } = auditRange(filter);
  const prefix = groupPrefix(filter.group);
  return { fromIso, toIsoExclusive, actor: filter.actor, like: prefix ? `${prefix}%` : null, target: filter.target };
}

/** Exact number of entries matching the filter; `maxId` bounds it to entries up to that id (a snapshot). */
export async function countAudit(filter: AuditFilter, maxId: number | null = null): Promise<number> {
  const supabase = await createSupabaseServer();
  const f = auditParams(filter);
  let q = supabase.from("audit_log").select("id", { count: "exact", head: true }).gte("occurred_at", f.fromIso).lt("occurred_at", f.toIsoExclusive);
  if (f.actor) q = q.eq("actor_id", f.actor);
  if (f.like) q = q.like("action", f.like);
  if (f.target) q = q.eq("target_id", f.target);
  if (maxId !== null) q = q.lte("id", maxId);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** The newest entry id matching the filter, or null when there is none. */
export async function maxAuditId(filter: AuditFilter): Promise<number | null> {
  const supabase = await createSupabaseServer();
  const f = auditParams(filter);
  let q = supabase.from("audit_log").select("id").gte("occurred_at", f.fromIso).lt("occurred_at", f.toIsoExclusive);
  if (f.actor) q = q.eq("actor_id", f.actor);
  if (f.like) q = q.like("action", f.like);
  if (f.target) q = q.eq("target_id", f.target);
  const { data, error } = await q.order("id", { ascending: false }).limit(1);
  if (error) throw error;
  const row = ((data ?? []) as { id: number }[])[0];
  return row ? row.id : null;
}

/** One page of the audit log, newest first; `before` is the id of the last entry already shown. */
export async function fetchAudit(filter: AuditFilter, before: number | null): Promise<{ rows: AuditRow[]; next: number | null; total: number }> {
  const supabase = await createSupabaseServer();
  const f = auditParams(filter);
  let q = supabase.from("audit_log").select(AUDIT_COLUMNS).gte("occurred_at", f.fromIso).lt("occurred_at", f.toIsoExclusive);
  if (f.actor) q = q.eq("actor_id", f.actor);
  if (f.like) q = q.like("action", f.like);
  if (f.target) q = q.eq("target_id", f.target);
  if (before !== null) q = q.lt("id", before);
  const [page, total] = await Promise.all([q.order("id", { ascending: false }).limit(AUDIT_PAGE + 1), countAudit(filter)]);
  if (page.error) throw page.error;
  const rows = ((page.data ?? []) as unknown as AuditDbRow[]).map(toAuditRow);
  const more = rows.length > AUDIT_PAGE;
  const shown = more ? rows.slice(0, AUDIT_PAGE) : rows;
  return { rows: shown, next: more ? shown[shown.length - 1].id : null, total };
}

/**
 * A stable snapshot of every matching entry, newest first: bounded by the newest id at the start and read
 * with keyset paging (no offsets), so entries written meanwhile are not included and none is read twice.
 * `overCap` is true when more than AUDIT_CSV_MAX entries exist; `rows` is then empty.
 */
export async function fetchAuditAll(filter: AuditFilter): Promise<{ rows: AuditRow[]; overCap: boolean }> {
  const maxId = await maxAuditId(filter);
  if (maxId === null) return { rows: [], overCap: false };
  if ((await countAudit(filter, maxId)) > AUDIT_CSV_MAX) return { rows: [], overCap: true };
  const supabase = await createSupabaseServer();
  const f = auditParams(filter);
  const all: AuditRow[] = [];
  let last: number | null = null;
  for (;;) {
    let q = supabase.from("audit_log").select(AUDIT_COLUMNS).gte("occurred_at", f.fromIso).lt("occurred_at", f.toIsoExclusive).lte("id", maxId);
    if (f.actor) q = q.eq("actor_id", f.actor);
    if (f.like) q = q.like("action", f.like);
    if (f.target) q = q.eq("target_id", f.target);
    if (last !== null) q = q.lt("id", last);
    const { data, error } = await q.order("id", { ascending: false }).limit(PAGE);
    if (error) throw error;
    const rows = ((data ?? []) as unknown as AuditDbRow[]).map(toAuditRow);
    all.push(...rows);
    if (all.length > AUDIT_CSV_MAX) return { rows: [], overCap: true };
    if (rows.length < PAGE) return { rows: all, overCap: false };
    last = rows[rows.length - 1].id;
  }
}

export type AuditPerson = { id: string; email: string; fullName: string | null };

/** Every profile, for the person filter. */
export async function fetchAuditPeople(): Promise<AuditPerson[]> {
  const supabase = await createSupabaseServer();
  return (await fetchProfiles(supabase)).map((p) => ({ id: p.id, email: p.email, fullName: p.full_name }));
}

export type TrashRow = { id: string; name: string; thumbUrl: string | null; deletedAt: string; deletedByName: string | null };

type TrashDbRow = { id: string; name: string; thumb_path: string; deleted_at: string; deleted_by_name: string | null };

/** Every sheet in the Trash, newest first, with short-lived thumbnail links (as in the sheet list). */
export async function fetchTrash(): Promise<TrashRow[]> {
  const supabase = await createSupabaseServer();
  const rows: TrashDbRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("sheet_list")
      .select("id, name, thumb_path, deleted_at, deleted_by_name")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as TrashDbRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const links = new Map<string, string>();
  if (rows.length > 0) {
    const ttl = (await fetchSettings()).signed_url_ttl_min * 60;
    for (let i = 0; i < rows.length; i += 200) {
      const { data: signed, error } = await supabase.storage.from("spec-sheets").createSignedUrls(rows.slice(i, i + 200).map((r) => r.thumb_path), ttl);
      if (error) console.error("createSignedUrls failed:", error.message);
      for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) links.set(s.path, s.signedUrl);
    }
  }
  return rows.map((r) => ({ id: r.id, name: r.name, thumbUrl: links.get(r.thumb_path) ?? null, deletedAt: r.deleted_at, deletedByName: r.deleted_by_name }));
}
