import { readFile } from "node:fs/promises";
import path from "node:path";
import { devPagesEnabled } from "@/lib/dev-pages";

/**
 * Serves samples/sample.png to the bench. The folder is git-ignored because real sheets carry order
 * numbers; developer tool only.
 */
export async function GET(): Promise<Response> {
  if (!devPagesEnabled()) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(path.join(process.cwd(), "samples", "sample.png"));
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch {
    return new Response("samples/sample.png not found", { status: 404 });
  }
}
