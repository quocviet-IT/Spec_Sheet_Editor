"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createUserErrorCode, type CreateUserError } from "@/auth/errors";
import { generateTempPassword } from "@/auth/password";
import { requireAdmin } from "@/auth/session";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

export type IssuedPassword = { email: string; tempPassword: string };
export type NewUserValues = { email: string; fullName: string; role: "user" | "admin" };

export type CreateUserState = {
  error: CreateUserError | "name_required" | "forbidden" | null;
  issued: IssuedPassword | null;
  values: NewUserValues;
};

const newUser = z.object({
  email: z.email().transform((s) => s.toLowerCase()),
  fullName: z.string().trim().min(1).max(120),
  role: z.enum(["user", "admin"]),
});

const EMPTY: NewUserValues = { email: "", fullName: "", role: "user" };

/**
 * Creates a password account (UC-13, decisions of 2026-10-08): the sign-in account is created with the
 * secret key, then registered in the Admin's own session so the audit row names the Admin. If the
 * registration fails the sign-in account is deleted again, so no half-made account can sign in.
 */
export async function createPasswordUser(_prev: CreateUserState, form: FormData): Promise<CreateUserState> {
  await requireAdmin("/admin/users");
  const values: NewUserValues = {
    email: String(form.get("email") ?? "").trim(),
    fullName: String(form.get("fullName") ?? ""),
    role: form.get("role") === "admin" ? "admin" : "user",
  };
  const parsed = newUser.safeParse(values);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field === "fullName" ? "name_required" : "invalid_email", issued: null, values };
  }
  const { email, fullName, role } = parsed.data;

  const tempPassword = generateTempPassword();
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) return { error: createUserErrorCode(error) ?? "unknown", issued: null, values };

  const supabase = await createSupabaseServer();
  let failure: string | null = null;
  try {
    const { error: registerError } = await supabase.rpc("admin_register_password_account", {
      p_user: data.user.id,
      p_full_name: fullName,
      p_role: role,
    });
    if (registerError) failure = registerError.message;
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  if (failure !== null) {
    try {
      const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
      if (deleteError) console.error("orphan sign-in account left behind:", data.user.id, deleteError.message);
    } catch (e) {
      console.error("orphan sign-in account left behind:", data.user.id, e instanceof Error ? e.message : String(e));
    }
    return { error: failure.includes("forbidden") ? "forbidden" : "unknown", issued: null, values };
  }
  revalidatePath("/admin/users");
  return { error: null, issued: { email, tempPassword }, values: EMPTY };
}

export type ResetPasswordState = {
  error: "self_reset" | "not_password_account" | "unknown" | null;
  issued: IssuedPassword | null;
};

/**
 * Issues a new one-time password: set with the secret key, then marked in the Admin's own session,
 * which also ends every session the person has.
 */
export async function resetPassword(_prev: ResetPasswordState, form: FormData): Promise<ResetPasswordState> {
  const me = await requireAdmin("/admin/users");
  const userId = String(form.get("userId") ?? "");
  if (!z.uuid().safeParse(userId).success) return { error: "unknown", issued: null };
  if (userId === me.id) return { error: "self_reset", issued: null };

  const supabase = await createSupabaseServer();
  const { data: target, error: readError } = await supabase
    .from("profiles")
    .select("email, password_account")
    .eq("id", userId)
    .maybeSingle<{ email: string; password_account: boolean }>();
  if (readError || !target) return { error: "unknown", issued: null };
  if (!target.password_account) return { error: "not_password_account", issued: null };

  const tempPassword = generateTempPassword();
  const { error } = await createSupabaseAdmin().auth.admin.updateUserById(userId, { password: tempPassword });
  if (error) return { error: "unknown", issued: null };
  const { error: markError } = await supabase.rpc("admin_mark_password_reset", { p_user: userId });
  if (markError) return { error: "unknown", issued: null };
  revalidatePath("/admin/users");
  return { error: null, issued: { email: target.email, tempPassword } };
}

type ChangeError = "last_admin" | "self_suspend" | "forbidden" | "not_found" | "unknown";

function mapChangeError(message: string): ChangeError {
  const found = (word: string) => new RegExp(`(?<![a-z_])${word}(?![a-z_])`).test(message);
  if (found("last_admin")) return "last_admin";
  if (found("self_suspend")) return "self_suspend";
  if (found("forbidden")) return "forbidden";
  if (found("user_not_found")) return "not_found";
  return "unknown";
}

const roleInput = z.object({ userId: z.uuid(), role: z.enum(["user", "admin"]) });
const statusInput = z.object({ userId: z.uuid(), status: z.enum(["active", "suspended"]) });

/** Changes a role in the Admin's own session, so the audit row names the Admin. */
export async function setRole(input: {
  userId: string;
  role: "user" | "admin";
}): Promise<{ ok: true } | { error: "last_admin" | "forbidden" | "not_found" | "unknown" }> {
  await requireAdmin("/admin/users");
  const parsed = roleInput.safeParse(input);
  if (!parsed.success) return { error: "unknown" };
  try {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("set_user_role", { p_user: parsed.data.userId, p_role: parsed.data.role });
    if (!error) return { ok: true };
    const code = mapChangeError(error.message);
    return { error: code === "self_suspend" ? "unknown" : code };
  } catch {
    return { error: "unknown" };
  }
}

/** Suspends or reinstates an account; the database refuses suspending oneself and the last active Admin. */
export async function setStatus(input: {
  userId: string;
  status: "active" | "suspended";
}): Promise<{ ok: true } | { error: ChangeError }> {
  await requireAdmin("/admin/users");
  const parsed = statusInput.safeParse(input);
  if (!parsed.success) return { error: "unknown" };
  try {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("set_user_status", { p_user: parsed.data.userId, p_status: parsed.data.status });
    if (!error) return { ok: true };
    return { error: mapChangeError(error.message) };
  } catch {
    return { error: "unknown" };
  }
}
