/**
 * The page Content-Security-Policy. Scripts run only with the per-request nonce (Next.js puts it on its
 * own scripts) or when loaded by such a script ('strict-dynamic'). Pure: used by the proxy and by tests.
 */
export function buildCsp({ nonce, supabaseUrl, dev }: { nonce: string; supabaseUrl: string; dev: boolean }): string {
  const supabase = new URL(supabaseUrl).origin;
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "blob:", "data:", supabase]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", supabase, ...(dev ? ["ws:"] : [])]],
    ["worker-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'", supabase, "https://accounts.google.com"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** 16 random bytes in base64: a fresh nonce for every page request. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
