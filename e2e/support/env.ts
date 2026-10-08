import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

let checked = false;

/** Refuses to run unless the URL host and the database user both name the development project. */
function assertDevProject(): void {
  if (checked) return;
  const ref = process.env.E2E_DEV_PROJECT_REF;
  if (!ref) throw new Error("E2E_DEV_PROJECT_REF is not set in .env.local; end-to-end tests refuse to run without naming the development project.");
  let host = "";
  try {
    host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    // left empty: the check below fails with the message
  }
  let user = "";
  try {
    user = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "").username);
  } catch {
    // left empty
  }
  if (host !== `${ref}.supabase.co` || user !== `postgres.${ref}`) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and DATABASE_URL do not both point at the project named by E2E_DEV_PROJECT_REF; refusing to run end-to-end tests.");
  }
  checked = true;
}

export function need(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SECRET_KEY" | "DATABASE_URL"): string {
  assertDevProject();
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local; end-to-end tests need the development project.`);
  return value;
}
