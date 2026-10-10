/**
 * TC-77: proves the secret key cannot reach the browser. Scans everything under .next/static for the
 * variable's name, the key prefix and the key's value. Prints labels and paths, never the value.
 * Runs after every build (postbuild), so a leak fails the build, on Vercel too.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { findLeaks, type ScanFile } from "./bundle-scan";

config({ path: ".env.local", quiet: true });

const root = path.join(process.cwd(), ".next", "static");
const EXTENSIONS = new Set([".js", ".css", ".json", ".html", ".txt", ".map"]);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

let names: string[];
try {
  names = await walk(root);
} catch {
  console.error("Bundle check: no .next/static folder; run the build first.");
  process.exit(1);
}

const files: ScanFile[] = [];
for (const name of names) files.push({ path: path.relative(process.cwd(), name).replaceAll("\\", "/"), text: await readFile(name, "utf8") });

const leaks = findLeaks(files, [
  { label: "the name SUPABASE_SECRET_KEY", value: "SUPABASE_SECRET_KEY" },
  // Not the bare prefix "sb_secret_": the Supabase client library itself holds that string to warn about secret keys in a browser.
  { label: "the secret key value", value: process.env.SUPABASE_SECRET_KEY ?? "" },
]);

// A key-shaped string (the prefix followed by the key body) stays a leak, whatever the key's value is.
const KEY_SHAPE = /sb_secret_[A-Za-z0-9_-]{16,}/;
for (const file of files) if (KEY_SHAPE.test(file.text)) leaks.push({ label: "a string shaped like a secret key", path: file.path });

if (leaks.length > 0) {
  console.error("Bundle check FAILED: the secret key may be in the browser bundle:");
  for (const leak of leaks) console.error(`  ${leak.label} in ${leak.path}`);
  process.exit(1);
}
console.log(`Bundle check: ${files.length} files, no secret found`);
