import "server-only";
import { createSupabaseServer } from "@/lib/supabase/server";

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
