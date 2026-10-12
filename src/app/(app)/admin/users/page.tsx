import { fetchUsers } from "@/admin/queries";
import { splitTestAccounts } from "@/admin/test-accounts";
import { requireAdmin } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { fill } from "@/messages/format";
import { AddUserForm } from "./add-user-form";
import { UsersTable } from "./users-table";

export default async function UsersPage() {
  const me = await requireAdmin("/admin/users");
  const t = await getMessages();
  const u = t.admin.users;
  const { people, tests } = splitTestAccounts(await fetchUsers());
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{u.title}</h1>
        <p className="text-ink-2">{u.lead}</p>
      </div>
      <AddUserForm />
      <UsersTable rows={people} meId={me.id} />
      {tests.length > 0 && (
        <details className="rounded-lg border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-2">
            {fill(u.testAccounts.title, { n: tests.length })}
          </summary>
          <div className="space-y-3 border-t border-line px-4 py-4">
            <p className="text-sm text-ink-2">{u.testAccounts.lead}</p>
            <UsersTable rows={tests} meId={me.id} searchable={false} />
          </div>
        </details>
      )}
    </section>
  );
}
