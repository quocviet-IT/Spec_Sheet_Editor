import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

/** Pure: used by tests and by getEnv. Throws one error that names every bad key. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment — ${detail}`);
  }
  return result.data;
}

let cached: Env | null = null;

/** Server-side environment, validated once per process. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
