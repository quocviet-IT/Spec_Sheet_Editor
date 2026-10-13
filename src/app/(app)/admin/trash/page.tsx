import { Trash2 } from "lucide-react";
import { pageInfo, parsePaging } from "@/admin/paging";
import { fetchTrashPage } from "@/admin/queries";
import { requireAdmin } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { PageHeader } from "../ui/page-header";
import { Pagination } from "@/ui/pagination";
import { OrphanPanel } from "./orphan-panel";
import { TrashTable } from "./trash-table";

export default async function TrashPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/trash");
  const params = await searchParams;
  const t = await getMessages();
  const a = t.admin.trash;
  const { page, size } = parsePaging(params);
  const { rows, total, page: shown } = await fetchTrashPage(page, size);
  const info = pageInfo(total, shown, size);
  const hrefFor = (p: number, s: number) => `/admin/trash?page=${p}&size=${s}`;
  return (
    <section className="space-y-6">
      <PageHeader icon={Trash2} title={a.title} lead={a.lead} />
      <div className="rounded-lg border border-line bg-surface">
        {/* The table stays mounted when the last row goes, so its status message (and focus) survives. */}
        <TrashTable rows={rows} />
        {total > 0 && <Pagination info={info} hrefFor={hrefFor} />}
      </div>
      <OrphanPanel />
    </section>
  );
}
