import { fetchTrash } from "@/admin/queries";
import { requireAdmin } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { OrphanPanel } from "./orphan-panel";
import { TrashTable } from "./trash-table";

export default async function TrashPage() {
  await requireAdmin("/admin/trash");
  const t = await getMessages();
  const a = t.admin.trash;
  const rows = await fetchTrash();
  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{a.title}</h1>
        <p className="text-ink-2">{a.lead}</p>
      </div>
      <TrashTable rows={rows} />
      <OrphanPanel />
    </section>
  );
}
