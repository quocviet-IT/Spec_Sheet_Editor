"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { recordDenied } from "./denied";
import { signInErrorCode, type SignInError } from "./errors";
import { safeNext } from "./redirect";

export type SignInState = { error: SignInError | "suspended" | "not_permitted" | null; email: string };

/**
 * Email + password sign-in (BR-08: only accounts an Admin created get in). After Supabase accepts the
 * password the database decides: someone on a one-time password goes to set their own; a refused
 * account is logged, signed out and told why; everyone else lands on the page they asked for.
 */
export async function signInWithPassword(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  if (!email || !password) return { error: "invalid", email };

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  const failed = signInErrorCode(error);
  if (failed || !data.user) return { error: failed ?? "unknown", email };

  const { data: status, error: statusError } = await supabase.rpc("my_access_status");
  if (statusError || status === "signed_out") {
    await supabase.auth.signOut();
    return { error: "unknown", email };
  }
  if (status === "must_change_password") redirect(`/account/password?next=${encodeURIComponent(next)}`);
  if (status !== "ok") {
    await recordDenied({ id: data.user.id, email: data.user.email ?? email }, String(status));
    await supabase.auth.signOut();
    return { error: status === "suspended" ? "suspended" : "not_permitted", email };
  }

  const { error: touchError } = await supabase.rpc("touch_profile");
  if (touchError) {
    await supabase.auth.signOut();
    return { error: "unknown", email };
  }
  redirect(next);
}

/** Starts Google OAuth (PKCE). The code verifier cookie is written here, read by /auth/callback. */
export async function signInWithGoogle(form: FormData): Promise<void> {
  const next = safeNext(String(form.get("next") ?? ""));
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
