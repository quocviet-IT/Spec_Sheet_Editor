import { fetchUsers } from "@/admin/queries";
import { requireAdmin } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { AddUserForm } from "./add-user-form";
import { UsersTable } from "./users-table";

export default async function UsersPage() {
  const me = await requireAdmin("/admin/users");
  const t = await getMessages();
  const u = t.admin.users;
  const rows = await fetchUsers();
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{u.title}</h1>
        <p className="text-ink-2">{u.lead}</p>
      </div>
      <AddUserForm />
      <UsersTable rows={rows} meId={me.id} />
    </section>
  );
}
