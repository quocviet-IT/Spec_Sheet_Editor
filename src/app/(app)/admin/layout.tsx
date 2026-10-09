import { headers } from "next/headers";
import { requireAdmin } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const next = (await headers()).get("x-pathname") ?? "/admin";
  await requireAdmin(next);
  const t = await getMessages();
  return (
    <>
      <p role="note" className="rounded-lg border border-line bg-sunk px-4 py-3 text-ink-2 lg:hidden">
        {t.admin.desktopOnly}
      </p>
      <div className="hidden lg:block">
        <AdminNav />
        {children}
      </div>
    </>
  );
}
