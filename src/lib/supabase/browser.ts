"use client";

import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** The person's own session in the browser: used only to upload a sheet's files (NFR-03). */
export function supabaseBrowser() {
  client ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  return client;
}
