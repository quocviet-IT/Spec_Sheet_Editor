import { fetchAccess, fetchSettings } from "@/admin/queries";
import { requireAdmin } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { AccessLists } from "./access-lists";
import { SettingsForm } from "./settings-form";

export default async function AccessPage() {
  await requireAdmin("/admin/access");
  const t = await getMessages();
  const a = t.admin.access;
  const [access, settings] = await Promise.all([fetchAccess(), fetchSettings()]);
  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{a.title}</h1>
        <p className="text-ink-2">{a.lead}</p>
      </div>
      <AccessLists domains={access.domains} emails={access.emails} />
      <SettingsForm initial={settings} />
    </section>
  );
}
