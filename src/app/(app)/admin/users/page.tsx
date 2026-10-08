import { requireAdmin } from "@/auth/session";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getLocale, getMessages } from "@/messages/server";
import { AddUserForm } from "./add-user-form";
import { ResetPasswordButton } from "./reset-password";

type Row = {
  id: string;
  email: string;
  full_name: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  password_account: boolean;
  must_change_password: boolean;
  last_seen_at: string | null;
};

export default async function UsersPage() {
  const me = await requireAdmin("/admin/users");
  const t = await getMessages();
  const locale = await getLocale();
  const u = t.admin.users;
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, status, password_account, must_change_password, last_seen_at")
    .order("email");
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const when = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  });
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{u.title}</h1>
        <p className="text-ink-2">{u.lead}</p>
      </div>
      <AddUserForm />
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-sunk text-left text-ink-2">
            <tr>
              <th className="px-3 py-2 font-medium">{u.columns.user}</th>
              <th className="px-3 py-2 font-medium">{u.columns.role}</th>
              <th className="px-3 py-2 font-medium">{u.columns.status}</th>
              <th className="px-3 py-2 font-medium">{u.columns.signIn}</th>
              <th className="px-3 py-2 font-medium">{u.columns.lastSeen}</th>
              <th className="px-3 py-2"><span className="sr-only">{u.columns.actions}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {row.full_name ?? row.email}
                    {row.id === me.id && <span className="font-normal text-ink-3"> {u.you}</span>}
                  </div>
                  <div className="font-mono text-xs text-ink-2">{row.email}</div>
                </td>
                <td className="px-3 py-2">{u.roles[row.role]}</td>
                <td className="px-3 py-2">
                  {u.status[row.status]}
                  {row.must_change_password && (
                    <span className="ml-2 whitespace-nowrap rounded bg-warn-soft px-1.5 py-0.5 text-xs">{u.mustChange}</span>
                  )}
                </td>
                <td className="px-3 py-2">{row.password_account ? u.signIn.password : u.signIn.google}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {row.last_seen_at ? when.format(new Date(row.last_seen_at)) : u.never}
                </td>
                <td className="px-3 py-2 text-right">
                  {row.password_account && row.id !== me.id && <ResetPasswordButton userId={row.id} email={row.email} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
