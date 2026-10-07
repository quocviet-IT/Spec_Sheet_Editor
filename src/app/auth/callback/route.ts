import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/auth/redirect";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Google sends people here. In order: exchange the code for a session; ask the database whether this
 * account may enter (BR-08, BR-14); if not, log auth.denied, end the session and explain; otherwise
 * create/update the profile (touch_profile logs auth.login) and continue to the requested page.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const go = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (!code) return go("/login?error=google");

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return go("/login?error=google");

  const { data: status, error: statusError } = await supabase.rpc("my_access_status");
  if (statusError) {
    await supabase.auth.signOut();
    return go("/login?error=google");
  }

  if (status !== "ok") {
    await createSupabaseAdmin()
      .from("audit_log")
      .insert({
        actor_email: data.user.email ?? null,
        action: "auth.denied",
        target_type: "user",
        target_id: data.user.id,
        detail: { reason: status },
      });
    await supabase.auth.signOut();
    return go(`/login?error=${status === "suspended" ? "suspended" : "not_permitted"}`);
  }

  const { error: touchError } = await supabase.rpc("touch_profile");
  if (touchError) {
    await supabase.auth.signOut();
    return go("/login?error=google");
  }
  return go(next);
}
