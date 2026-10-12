import { Ban, CircleCheck, ShieldCheck, Users } from "lucide-react";
import { fetchUsers } from "@/admin/queries";
import { splitTestAccounts } from "@/admin/test-accounts";
import { requireAdmin } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { PageHeader } from "../ui/page-header";
import { StatCards } from "../ui/stat-cards";
import { AddUser } from "./add-user";
import { UsersTable } from "./users-table";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAdmin("/admin/users");
  const [t, params] = await Promise.all([getMessages(), searchParams]);
  const u = t.admin.users;
  const { people, tests } = splitTestAccounts(await fetchUsers());
  // The reserved test accounts are shown only for the automated tests, which add ?show=test; nothing links to it.
  const rows = params.show === "test" ? [...people, ...tests] : people;
  return (
    <section>
      <PageHeader icon={Users} title={u.title} lead={u.lead} action={<AddUser />} />
      <StatCards
        items={[
          { icon: Users, label: u.stats.total, value: people.length },
          { icon: CircleCheck, label: u.stats.active, value: people.filter((r) => r.status === "active").length },
          { icon: Ban, label: u.stats.suspended, value: people.filter((r) => r.status === "suspended").length },
          { icon: ShieldCheck, label: u.stats.admins, value: people.filter((r) => r.role === "admin").length },
        ]}
      />
      <UsersTable rows={rows} meId={me.id} />
    </section>
  );
}
