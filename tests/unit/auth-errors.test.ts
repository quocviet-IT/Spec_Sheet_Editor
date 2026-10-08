import { describe, expect, it } from "vitest";
import { createUserErrorCode, passwordUpdateErrorCode, signInErrorCode } from "@/auth/errors";

describe("Supabase Auth errors", () => {
  it("sign-in: wrong email or password look the same to the person", () => {
    expect(signInErrorCode(null)).toBeNull();
    expect(signInErrorCode({ code: "invalid_credentials", status: 400 })).toBe("invalid");
    expect(signInErrorCode({ code: "email_not_confirmed" })).toBe("invalid");
    expect(signInErrorCode({ code: "user_banned" })).toBe("invalid");
    expect(signInErrorCode({ code: "over_request_rate_limit", status: 429 })).toBe("rate_limited");
    expect(signInErrorCode({ status: 429 })).toBe("rate_limited");
    expect(signInErrorCode({ code: "unexpected_failure", status: 500 })).toBe("unknown");
  });

  it("password change", () => {
    expect(passwordUpdateErrorCode(null)).toBeNull();
    expect(passwordUpdateErrorCode({ code: "same_password" })).toBe("same");
    expect(passwordUpdateErrorCode({ code: "weak_password" })).toBe("weak");
    expect(passwordUpdateErrorCode({ code: "reauthentication_needed" })).toBe("reauth");
    expect(passwordUpdateErrorCode({ code: "session_not_found" })).toBe("unknown");
  });

  it("account creation", () => {
    expect(createUserErrorCode(null)).toBeNull();
    expect(createUserErrorCode({ code: "email_exists" })).toBe("email_taken");
    expect(createUserErrorCode({ code: "user_already_exists" })).toBe("email_taken");
    expect(createUserErrorCode({ code: "email_address_invalid" })).toBe("invalid_email");
    expect(createUserErrorCode({ code: "validation_failed" })).toBe("invalid_email");
    expect(createUserErrorCode({ code: "weak_password" })).toBe("weak");
    expect(createUserErrorCode({ code: "unexpected_failure" })).toBe("unknown");
  });
});
