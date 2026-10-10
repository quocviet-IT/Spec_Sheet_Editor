import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "@/lib/security/csp";

/**
 * Runs on every page request (Next.js 16 "proxy", formerly middleware):
 * 1. passes the requested path to server components as `x-pathname`, so a guard can send people
 *    back to the same page after sign-in;
 * 2. refreshes the Supabase session (access tokens live one hour; Server Components cannot write cookies).
 * It does not guard anything — guarding lives in requireUser()/requireAdmin() and in RLS.
 */
function forwardHeaders(request: NextRequest, csp: string): Headers {
  const headers = new Headers(request.headers);
  // Next.js reads the script nonce from the policy on the forwarded request.
  headers.set("Content-Security-Policy", csp);
  headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  return headers;
}

/** One place builds every response, so no path can miss the policy. */
function nextResponse(request: NextRequest, csp: string): NextResponse {
  const response = NextResponse.next({ request: { headers: forwardHeaders(request, csp) } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export async function proxy(request: NextRequest) {
  const csp = buildCsp({
    nonce: newNonce(),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    dev: process.env.NODE_ENV === "development",
  });
  let response = nextResponse(request, csp);

  // No Supabase cookie means no session to refresh: skip the network call to Supabase Auth.
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list, cacheHeaders) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = nextResponse(request, csp);
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          // A response that sets auth cookies must never be cached by a CDN (@supabase/ssr contract).
          Object.entries(cacheHeaders).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // getUser() refreshes the token; getSession() only reads the cookie and would not.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|models/|ocr/|pdfjs/|fonts/|.*\\.(?:png|jpg|jpeg|svg|ico|onnx|woff2|wasm|mjs)$).*)",
  ],
};
