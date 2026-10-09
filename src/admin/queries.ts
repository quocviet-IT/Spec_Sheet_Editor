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

/** Every account with the number of sheets it created; the Admin may read every profile and sheet. */
export async function fetchUsers(): Promise<UserRow[]> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, status, password_account, must_change_password, last_seen_at")
    .order("email");
  if (error) throw error;
  const profiles = (data ?? []) as ProfileRow[];
  const counts = await Promise.all(
    profiles.map(async (p) => {
      const { count, error: countError } = await supabase
        .from("spec_sheets")
        .select("id", { count: "exact", head: true })
        .eq("created_by", p.id);
      if (countError) throw countError;
      return count ?? 0;
    }),
  );
  return profiles.map((p, i) => ({
    id: p.id,
    email: p.email,
    fullName: p.full_name,
    role: p.role,
    status: p.status,
    passwordAccount: p.password_account,
    mustChangePassword: p.must_change_password,
    lastSeenAt: p.last_seen_at,
    sheets: counts[i] ?? 0,
  }));
}
