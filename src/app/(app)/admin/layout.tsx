import { headers } from "next/headers";
import { requireAdmin } from "@/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const next = (await headers()).get("x-pathname") ?? "/admin";
  await requireAdmin(next);
  return <>{children}</>;
}
