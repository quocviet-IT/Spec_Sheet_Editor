"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const kindSchema = z.enum(["domain", "email"]);
const valueSchema = z.string().trim().toLowerCase();
const addInput = z.object({ kind: kindSchema, value: valueSchema, note: z.string().trim().max(200) }).superRefine((v, ctx) => {
  const ok = v.kind === "domain" ? DOMAIN.test(v.value) : z.email().safeParse(v.value).success;
  if (!ok) ctx.addIssue({ code: "custom", path: ["value"], message: "invalid" });
});
const removeInput = z.object({ kind: kindSchema, value: valueSchema.min(1).max(320) });

function has(message: string, word: string): boolean {
  return new RegExp(`(?<![a-z_])${word}(?![a-z_])`).test(message);
}

/** Adds a permitted domain or email in the Admin's own session, so the audit row names the Admin. */
export async function addAllowed(input: {
  kind: "domain" | "email";
  value: string;
  note: string;
}): Promise<{ ok: true; value: string } | { error: "invalid" | "duplicate" | "forbidden" | "unknown" }> {
  await requireAdmin("/admin/access");
  const parsed = addInput.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { kind, value, note } = parsed.data;
  try {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("add_allowed", { p_kind: kind, p_value: value, p_note: note === "" ? null : note });
    if (!error) {
      revalidatePath("/admin/access");
      return { ok: true, value };
    }
    if (error.code === "23505") return { error: "duplicate" };
    if (has(error.message, "forbidden")) return { error: "forbidden" };
    return { error: "unknown" };
  } catch {
    return { error: "unknown" };
  }
}

/** Removes a permitted domain or email; the database refuses a change that would lock the Admin out. */
export async function removeAllowed(input: {
  kind: "domain" | "email";
  value: string;
}): Promise<{ ok: true } | { error: "self_lockout" | "forbidden" | "unknown" }> {
  await requireAdmin("/admin/access");
  const parsed = removeInput.safeParse(input);
  if (!parsed.success) return { error: "unknown" };
  try {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.rpc("remove_allowed", { p_kind: parsed.data.kind, p_value: parsed.data.value });
    if (!error) {
      revalidatePath("/admin/access");
      return { ok: true };
    }
    if (has(error.message, "self_lockout")) return { error: "self_lockout" };
    if (has(error.message, "forbidden")) return { error: "forbidden" };
    return { error: "unknown" };
  } catch {
    return { error: "unknown" };
  }
}
