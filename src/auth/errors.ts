/** The parts of a Supabase Auth error the app looks at. */
export type AuthErrorLike = { code?: string; status?: number };

export type SignInError = "invalid" | "rate_limited" | "unknown";

/** Never tell "no such email" from "wrong password": both are "invalid". */
export function signInErrorCode(error: AuthErrorLike | null): SignInError | null {
  if (!error) return null;
  if (error.code === "over_request_rate_limit" || error.status === 429) return "rate_limited";
  if (error.code === "invalid_credentials" || error.code === "email_not_confirmed" || error.code === "user_banned") return "invalid";
  return "unknown";
}

export type PasswordUpdateError = "same" | "weak" | "reauth" | "unknown";

export function passwordUpdateErrorCode(error: AuthErrorLike | null): PasswordUpdateError | null {
  if (!error) return null;
  if (error.code === "same_password") return "same";
  if (error.code === "weak_password") return "weak";
  if (error.code === "reauthentication_needed") return "reauth";
  return "unknown";
}

export type CreateUserError = "email_taken" | "invalid_email" | "weak" | "unknown";

export function createUserErrorCode(error: AuthErrorLike | null): CreateUserError | null {
  if (!error) return null;
  if (error.code === "email_exists" || error.code === "user_already_exists") return "email_taken";
  if (error.code === "email_address_invalid" || error.code === "validation_failed") return "invalid_email";
  if (error.code === "weak_password") return "weak";
  return "unknown";
}
