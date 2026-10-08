import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

export function need(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SECRET_KEY" | "DATABASE_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local; end-to-end tests need the development project.`);
  return value;
}
