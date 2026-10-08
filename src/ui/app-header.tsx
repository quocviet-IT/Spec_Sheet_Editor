import Link from "next/link";
import type { Profile } from "@/auth/access";
import { signOut } from "@/auth/actions";
import type { Messages } from "@/messages";
import { LanguageSwitch } from "./language-switch";

export function AppHeader({ me, t }: { me: Profile; t: Messages }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
        <Link href="/sheets" className="font-bold tracking-tight">
          {t.app.name}
        </Link>
        <nav className="flex items-center gap-3 text-sm text-ink-2">
          <Link href="/sheets" className="hover:text-ink">{t.common.sheets}</Link>
          {me.role === "admin" && (
            <Link href="/admin" className="hover:text-ink">{t.common.admin}</Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitch />
          <span className="hidden text-sm text-ink-2 sm:inline" title={me.email}>
            {me.fullName ?? me.email}
          </span>
          {me.passwordAccount && (
            <Link href="/account/password" className="text-sm text-ink-2 hover:text-ink">
              {t.common.changePassword}
            </Link>
          )}
          <form action={signOut}>
            <button type="submit" className="rounded border border-line px-3 py-1 text-sm hover:bg-sunk">
              {t.common.signOut}
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
