/**
 * The path to land on after sign-in. Only same-site absolute paths are accepted, so a crafted
 * ?next= cannot send people to another site or back into the sign-in loop.
 */
export function safeNext(raw: string | null | undefined, fallback = "/sheets"): string {
  if (!raw || !raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/auth/")) return fallback;
  return raw;
}
