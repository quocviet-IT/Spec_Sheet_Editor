/** Any origin works: it only lets the URL parser resolve a path exactly as the redirect will. */
const PROBE = "http://same-origin.invalid";

/**
 * The path to land on after sign-in. Only same-site absolute paths are accepted, so a crafted
 * ?next= cannot send people to another site or back into the sign-in loop. Control characters and
 * backslashes are refused outright: URL parsers drop or rewrite them, which can turn "/\t/x" into "//x".
 */
export function safeNext(raw: string | null | undefined, fallback = "/sheets"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  const url = new URL(raw, PROBE);
  if (url.origin !== PROBE) return fallback;
  const path = url.pathname;
  if (path === "/login" || path.startsWith("/login/") || path === "/auth" || path.startsWith("/auth/")) return fallback;
  return raw;
}
