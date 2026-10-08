import { NextResponse, type NextRequest } from "next/server";
import { recordDenied } from "@/auth/denied";
import { safeNext } from "@/auth/redirect";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Google sends people here. In order: exchange the code for a session; ask the database whether this
 * account may enter (BR-08, BR-14); if not, log auth.denied, end the session and explain; otherwise
 * create/update the profile (touch_profile logs auth.login) and continue to the requested page.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  // Every response here may carry session cookies: never let a CDN cache it.
  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, url.origin));
    response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate, max-age=0");
    return response;
  };
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (!code) return go("/login?error=google");

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return go("/login?error=google");

  const { data: status, error: statusError } = await supabase.rpc("my_access_status");
  if (statusError || status === "signed_out") {
    await supabase.auth.signOut();
    return go("/login?error=google");
  }

  if (status !== "ok") {
    await recordDenied({ id: data.user.id, email: data.user.email ?? null }, status);
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
