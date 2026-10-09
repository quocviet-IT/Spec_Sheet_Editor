import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

let checked = false;

/** Refuses to run unless the URL host names the development project (and, when a database URL is set, its user does too). */
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
  if (host !== `${ref}.supabase.co`) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL does not point at the project named by E2E_DEV_PROJECT_REF; refusing to run end-to-end tests.");
  }
  // The tests no longer use DATABASE_URL, but a wrong one in .env.local is still a sign of a mixed-up file.
  if (process.env.DATABASE_URL) {
    let user = "";
    try {
      user = decodeURIComponent(new URL(process.env.DATABASE_URL).username);
    } catch {
      // left empty
    }
    if (user !== `postgres.${ref}`) {
      throw new Error("DATABASE_URL does not point at the project named by E2E_DEV_PROJECT_REF; refusing to run end-to-end tests.");
    }
  }
  checked = true;
}

export function need(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SECRET_KEY"): string {
  assertDevProject();
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local; end-to-end tests need the development project.`);
  return value;
}
