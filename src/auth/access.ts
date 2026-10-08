export type Role = "user" | "admin";
export type Status = "active" | "suspended";
export type AccessStatus = "ok" | "signed_out" | "not_permitted" | "suspended" | "must_change_password";

export type Profile = {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: Role;
  status: Status;
  /** Created by an Admin with a password (as opposed to a Google account). */
  passwordAccount: boolean;
};

export type Need = "user" | "admin";

export type Decision =
  | { kind: "allow"; profile: Profile }
  | { kind: "login"; error?: "not_permitted" | "suspended" }
  | { kind: "change_password" }
  | { kind: "not_found" };

/**
 * The whole access rule for pages, as a pure function. The database is the real gate (RLS); this only
 * decides what the visitor sees: the page, the sign-in screen with a reason, or a 404 for Admin pages.
 */
export function decideAccess(profile: Profile | null, status: AccessStatus, need: Need): Decision {
  if (status === "signed_out") return { kind: "login" };
  if (status === "must_change_password") return { kind: "change_password" };
  if (status === "suspended") return { kind: "login", error: "suspended" };
  if (status === "not_permitted") return { kind: "login", error: "not_permitted" };
  if (profile === null) return { kind: "login" };
  if (profile.status !== "active") return { kind: "login", error: "suspended" };
  if (need === "admin" && profile.role !== "admin") return { kind: "not_found" };
  return { kind: "allow", profile };
}
