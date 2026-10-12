export type UserStatusFilter = "all" | "active" | "suspended" | "waiting";
export type FilterableUser = {
  email: string;
  fullName: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  passwordAccount: boolean;
  mustChangePassword: boolean;
};

/** Lower-case text without accents, so "nhan" finds "Nhân". */
export function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");
}

const waiting = (r: FilterableUser) => r.status === "active" && r.passwordAccount && r.mustChangePassword;

/** The users list after search (name or email, accents ignored), role and status; order is kept. */
export function filterUsers<T extends FilterableUser>(rows: readonly T[], f: { query: string; role: "all" | "user" | "admin"; status: UserStatusFilter }): T[] {
  const needle = fold(f.query.trim());
  return rows.filter((r) => {
    if (needle && !fold(r.email).includes(needle) && !fold(r.fullName ?? "").includes(needle)) return false;
    if (f.role !== "all" && r.role !== f.role) return false;
    if (f.status === "suspended") return r.status === "suspended";
    if (f.status === "waiting") return waiting(r);
    if (f.status === "active") return r.status === "active" && !waiting(r);
    return true;
  });
}
