import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { afterPassword, safeNext } from "@/auth/redirect";
import { loadAccess } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { LanguageSwitch } from "@/ui/language-switch";
import { ChangePasswordForm } from "./form";

/**
 * Outside the (app) layout on purpose: someone on a one-time password may not see any app page yet,
 * but must reach this one. Google accounts have no password here.
 */
export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = afterPassword(safeNext(params.next));
  const { profile, status } = await loadAccess();
  if (status === "signed_out") redirect(`/login?next=${encodeURIComponent("/account/password")}`);
  if (status === "suspended" || status === "not_permitted") redirect(`/login?error=${status}`);
  const forced = status === "must_change_password";
  if (!forced && !profile?.passwordAccount) notFound();

  const t = await getMessages();
  const m = t.account.password;
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{forced ? m.titleForced : m.title}</h1>
            <p className="mt-1 text-sm text-ink-2">{forced ? m.leadForced : m.lead}</p>
          </div>
          <LanguageSwitch />
        </div>
        <ChangePasswordForm next={next} />
        {!forced && (
          <Link href={next} className="block text-center text-sm text-ink-2 hover:text-ink">
            {m.back}
          </Link>
        )}
      </div>
    </main>
  );
}
