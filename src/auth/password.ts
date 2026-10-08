/** Shortest password the app accepts (also the one-time passwords it issues are longer than this). */
export const MIN_PASSWORD_LENGTH = 10;

// No i, l, o, 0 or 1: a one-time password is read aloud or copied by hand.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
// Largest multiple of the alphabet size below 256: bytes at or above it are skipped (no modulo bias).
const LIMIT = 256 - (256 % ALPHABET.length);

function cryptoBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/**
 * A one-time password an Admin hands over, e.g. "kp7m-x3qd-9hwa": 12 characters (about 59 bits),
 * at least one letter and one digit so it passes common password rules.
 */
export function generateTempPassword(randomBytes: (n: number) => Uint8Array = cryptoBytes): string {
  for (;;) {
    const chars: string[] = [];
    while (chars.length < 12) {
      for (const b of randomBytes(16)) {
        if (b < LIMIT && chars.length < 12) chars.push(ALPHABET[b % ALPHABET.length]);
      }
    }
    const body = chars.join("");
    if (/[a-z]/.test(body) && /[2-9]/.test(body)) {
      return `${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
    }
  }
}

export type NewPasswordError = "too_short" | "mismatch";

/** The rules the app checks before asking Supabase to change a password. */
export function checkNewPassword(password: string, confirm: string): NewPasswordError | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (password !== confirm) return "mismatch";
  return null;
}
