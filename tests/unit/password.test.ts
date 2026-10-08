import { describe, expect, it } from "vitest";
import { checkNewPassword, generateTempPassword, MIN_PASSWORD_LENGTH } from "@/auth/password";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

describe("generateTempPassword", () => {
  it("gives three groups of four unambiguous characters with a letter and a digit", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword();
      expect(pw).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
      for (const ch of pw.replaceAll("-", "")) expect(ALPHABET).toContain(ch);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[2-9]/);
    }
  });

  it("is long enough to pass the password rule", () => {
    expect(generateTempPassword().length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
  });

  it("skips byte values that would bias the alphabet and redraws until both kinds of character appear", () => {
    // 255 is rejected (>= 248); 0 -> 'a'; 30 -> '9'
    const batches = [
      new Uint8Array(16).fill(0),
      Uint8Array.from([255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 0, 0, 0, 0]),
    ];
    let call = 0;
    const pw = generateTempPassword(() => batches[Math.min(call++, batches.length - 1)]);
    expect(pw).toBe("aaaa-aaaa-aa9a");
  });
});

describe("checkNewPassword", () => {
  it("needs at least 10 characters", () => {
    expect(checkNewPassword("a".repeat(9), "a".repeat(9))).toBe("too_short");
    expect(checkNewPassword("a".repeat(10), "a".repeat(10))).toBeNull();
  });

  it("needs both entries to match", () => {
    expect(checkNewPassword("correct horse", "correct house")).toBe("mismatch");
  });
});
