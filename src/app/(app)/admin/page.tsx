import Link from "next/link";
import { getMessages } from "@/messages/server";

export default async function AdminPage() {
  const t = await getMessages();
  const later = [t.admin.areas.access, t.admin.areas.audit, t.admin.areas.cleanup];
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t.admin.title}</h1>
      <p className="text-ink-2">{t.admin.lead}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        <li>
          <Link href="/admin/users" className="block rounded-lg border border-line bg-surface px-4 py-3 font-medium hover:bg-sunk">
            {t.admin.areas.users}
          </Link>
        </li>
        {later.map((name) => (
          <li key={name} className="rounded-lg border border-line bg-surface px-4 py-3 font-medium">
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}
