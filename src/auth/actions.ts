"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { recordDenied } from "./denied";
import { passwordUpdateErrorCode, signInErrorCode, type PasswordUpdateError, type SignInError } from "./errors";
import { checkNewPassword, type NewPasswordError } from "./password";
import { afterPassword, safeNext } from "./redirect";

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

export type ChangePasswordState = { error: NewPasswordError | PasswordUpdateError | null };

/**
 * Sets a new password for the signed-in password account. After a one-time password this also lets
 * the person in: the database clears the flag only once the stored hash has changed, then the
 * sign-in is recorded (touch_profile).
 */
export async function changePassword(_prev: ChangePasswordState, form: FormData): Promise<ChangePasswordState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const next = afterPassword(safeNext(String(form.get("next") ?? "")));
  const invalid = checkNewPassword(password, confirm);
  if (invalid) return { error: invalid };

  const supabase = await createSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent("/account/password")}`);
  const { data: before, error: beforeError } = await supabase.rpc("my_access_status");
  if (beforeError || (before !== "ok" && before !== "must_change_password")) {
    redirect(before === "suspended" || before === "not_permitted" ? `/login?error=${before}` : "/login");
  }
  if (before === "ok") {
    // Google accounts have no password here (the page hides the form; the action refuses too).
    const { data: me } = await supabase
      .from("profiles")
      .select("password_account")
      .eq("id", auth.user.id)
      .maybeSingle<{ password_account: boolean }>();
    if (!me?.password_account) return { error: "unknown" };
  }

  const { error } = await supabase.auth.updateUser({ password });
  const failed = passwordUpdateErrorCode(error);
  if (failed && failed !== "same") return { error: failed };

  // On "same" the password may already have changed in an earlier attempt that was never recorded:
  // the database compares hashes and decides.
  const { error: finishError } = await supabase.rpc("finish_password_change");
  if (finishError) return { error: finishError.message.includes("password_unchanged") ? "same" : "unknown" };
  if (before === "must_change_password") {
    const { error: touchError } = await supabase.rpc("touch_profile");
    // Access is already granted at this point; a missed last-seen update must not trap the person here.
    if (touchError) console.error("touch_profile failed after a password change:", touchError.message);
  }
  redirect(next);
}
