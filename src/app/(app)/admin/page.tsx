import Link from "next/link";
import { getMessages } from "@/messages/server";

export default async function AdminPage() {
  const t = await getMessages();
  const areas = [
    { href: "/admin/users", name: t.admin.areas.users, lead: t.admin.areaLeads.users },
    { href: "/admin/access", name: t.admin.areas.access, lead: t.admin.areaLeads.access },
    { href: "/admin/audit", name: t.admin.areas.audit, lead: t.admin.areaLeads.audit },
    { href: "/admin/trash", name: t.admin.areas.cleanup, lead: t.admin.areaLeads.cleanup },
  ];
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t.admin.title}</h1>
      <p className="text-ink-2">{t.admin.lead}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {areas.map((area) => (
          <li key={area.href}>
            <Link href={area.href} className="block rounded-lg border border-line bg-surface px-4 py-3 hover:bg-sunk">
              <span className="block font-medium">{area.name}</span>
              <span className="block text-sm text-ink-2">{area.lead}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
