import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { decideAccess, type AccessStatus, type Need, type Profile } from "./access";

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: Profile["role"];
  status: Profile["status"];
  password_account: boolean;
};

/** One read per request (layout and page both call the guards). */
export const loadAccess = cache(async (): Promise<{ profile: Profile | null; status: AccessStatus }> => {
  const supabase = await createSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { profile: null, status: "signed_out" };

  const { data: status, error } = await supabase.rpc("my_access_status");
  if (error) throw error;
  if (status !== "ok") return { profile: null, status: status as AccessStatus };

  const { data: row, error: readError } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, role, status, password_account")
    .eq("id", auth.user.id)
    .maybeSingle<ProfileRow>();
  if (readError) throw readError;

  const profile: Profile | null = row
    ? { id: row.id, email: row.email, fullName: row.full_name, avatarUrl: row.avatar_url, role: row.role, status: row.status, passwordAccount: row.password_account }
    : null;
  return { profile, status: "ok" };
});

async function ensure(need: Need, next: string): Promise<Profile> {
  const { profile, status } = await loadAccess();
  const decision = decideAccess(profile, status, need);
  if (decision.kind === "allow") return decision.profile;
  if (decision.kind === "not_found") notFound();
  if (decision.kind === "change_password") redirect("/account/password");
  const query = new URLSearchParams({ next });
  if (decision.error) query.set("error", decision.error);
  redirect(`/login?${query.toString()}`);
}

export function requireUser(next = "/sheets"): Promise<Profile> {
  return ensure("user", next);
}

export function requireAdmin(next = "/admin"): Promise<Profile> {
  return ensure("admin", next);
}
