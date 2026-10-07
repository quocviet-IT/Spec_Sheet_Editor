import { getMessages } from "@/messages/server";

export default async function AdminPage() {
  const t = await getMessages();
  const areas = [t.admin.areas.users, t.admin.areas.access, t.admin.areas.audit, t.admin.areas.cleanup];
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t.admin.title}</h1>
      <p className="text-ink-2">{t.admin.lead}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {areas.map((name) => (
          <li key={name} className="rounded-lg border border-line bg-surface px-4 py-3 font-medium">
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}
