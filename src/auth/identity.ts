/** The caller's identity as read from verified JWT claims. */
export type Identity = { id: string; email: string | null };

/**
 * Pulls the user id and email out of claims that `auth.getClaims()` has already verified.
 * A token without a string `sub` has no identity. The email is only kept when it is a non-empty string;
 * nothing here grants access, the database decides that.
 */
export function identityFromClaims(claims: { sub?: unknown; email?: unknown } | null | undefined): Identity | null {
  if (!claims || typeof claims.sub !== "string" || claims.sub === "") return null;
  const email = typeof claims.email === "string" && claims.email !== "" ? claims.email : null;
  return { id: claims.sub, email };
}
