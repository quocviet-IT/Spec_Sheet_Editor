import { ShieldCheck } from "lucide-react";
import { fetchAccess, fetchSettings } from "@/admin/queries";
import { requireAdmin } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { PageHeader } from "../ui/page-header";
import { AccessLists } from "./access-lists";
import { SettingsForm } from "./settings-form";

export default async function AccessPage() {
  await requireAdmin("/admin/access");
  const t = await getMessages();
  const a = t.admin.access;
  const [access, settings] = await Promise.all([fetchAccess(), fetchSettings()]);
  return (
    <section>
      <PageHeader icon={ShieldCheck} title={a.title} lead={a.lead} />
      <div className="space-y-6">
        <AccessLists domains={access.domains} emails={access.emails} />
        <SettingsForm initial={settings} />
      </div>
    </section>
  );
}
