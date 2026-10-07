import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
};

describe("parseEnv", () => {
  it("accepts a complete environment", () => {
    expect(parseEnv(good)).toEqual(good);
  });

  it("names every missing key", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_SUPABASE_URL: good.NEXT_PUBLIC_SUPABASE_URL })).toThrow(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.*SUPABASE_SECRET_KEY/,
    );
  });

  it("rejects a URL that is not a URL", () => {
    expect(() => parseEnv({ ...good, NEXT_PUBLIC_SUPABASE_URL: "abc.supabase" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
