import "server-only";
import { createSupabaseServer } from "@/lib/supabase/server";
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

export type AccessEntry = { value: string; note: string | null; accounts: number };

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

/** Every profile's email, paged. */
async function fetchProfileEmails(supabase: Supabase): Promise<string[]> {
  const all: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("profiles")
      .select("email")
      .order("email")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { email: string }[];
    for (const r of rows) all.push(r.email.toLowerCase());
    if (rows.length < PAGE) return all;
  }
}

/** The permitted domains and emails, each with the number of accounts it admits (case-insensitive). */
export async function fetchAccess(): Promise<{ domains: AccessEntry[]; emails: AccessEntry[] }> {
  const supabase = await createSupabaseServer();
  const [domains, emails, profileEmails] = await Promise.all([
    fetchAllowed(supabase, "allowed_domains", "domain"),
    fetchAllowed(supabase, "allowed_emails", "email"),
    fetchProfileEmails(supabase),
  ]);
  const byDomain = new Map<string, number>();
  const byEmail = new Map<string, number>();
  for (const e of profileEmails) {
    byEmail.set(e, (byEmail.get(e) ?? 0) + 1);
    const domain = e.slice(e.lastIndexOf("@") + 1);
    byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
  }
  return {
    domains: domains.map((d) => ({ ...d, accounts: byDomain.get(d.value.toLowerCase()) ?? 0 })),
    emails: emails.map((d) => ({ ...d, accounts: byEmail.get(d.value.toLowerCase()) ?? 0 })),
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
