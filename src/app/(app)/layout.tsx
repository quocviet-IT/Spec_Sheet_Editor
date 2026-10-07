import { headers } from "next/headers";
import { requireUser } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { AppHeader } from "@/ui/app-header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const next = (await headers()).get("x-pathname") ?? "/sheets";
  const me = await requireUser(next);
  const t = await getMessages();
  return (
    <>
      <AppHeader me={me} t={t} />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
