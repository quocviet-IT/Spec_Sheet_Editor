import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();
const signOut = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithPassword, signOut } }),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" }),
}));

import { passwordIsCurrent } from "@/auth/verify-password";

describe("passwordIsCurrent", () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    signOut.mockReset().mockResolvedValue({ error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("is ok when Supabase accepts it, and ends only that check's session", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    expect(await passwordIsCurrent("a@b.co", "pw")).toBe("ok");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("is wrong for invalid credentials", async () => {
    signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials", status: 400 } });
    expect(await passwordIsCurrent("a@b.co", "pw")).toBe("wrong");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("is unavailable when rate limited", async () => {
    signInWithPassword.mockResolvedValue({ error: { status: 429 } });
    expect(await passwordIsCurrent("a@b.co", "pw")).toBe("unavailable");
  });

  it("is unavailable on an unexpected failure", async () => {
    signInWithPassword.mockResolvedValue({ error: { code: "unexpected_failure", status: 500 } });
    expect(await passwordIsCurrent("a@b.co", "pw")).toBe("unavailable");
  });

  it("is unavailable when the call throws", async () => {
    signInWithPassword.mockRejectedValue(new Error("network down"));
    expect(await passwordIsCurrent("a@b.co", "pw")).toBe("unavailable");
  });
});
