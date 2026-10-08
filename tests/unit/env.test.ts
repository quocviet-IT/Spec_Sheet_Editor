import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
};

describe("parseEnv", () => {
  it("accepts a complete environment; Google sign-in is off unless switched on", () => {
    expect(parseEnv(good)).toEqual({ ...good, GOOGLE_SIGN_IN: "off" });
    expect(parseEnv({ ...good, GOOGLE_SIGN_IN: "on" }).GOOGLE_SIGN_IN).toBe("on");
  });

  it("rejects an unknown GOOGLE_SIGN_IN value", () => {
    expect(() => parseEnv({ ...good, GOOGLE_SIGN_IN: "yes" })).toThrow(/GOOGLE_SIGN_IN/);
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
