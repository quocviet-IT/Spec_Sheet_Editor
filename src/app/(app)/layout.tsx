import { headers } from "next/headers";
import { requireUser } from "@/auth/session";
import { fetchFeedbackUnseen } from "@/feedback/queries";
import { getMessages } from "@/messages/server";
import { AppHeader } from "@/ui/app-header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const next = (await headers()).get("x-pathname") ?? "/sheets";
  const me = await requireUser(next);
  const [t, feedbackUnseen] = await Promise.all([getMessages(), fetchFeedbackUnseen()]);
  return (
    <>
      <AppHeader me={me} t={t} feedbackUnseen={feedbackUnseen} />
      <main className="mx-auto max-w-6xl px-4 py-6 has-[[data-wide]]:max-w-none">{children}</main>
    </>
  );
}
