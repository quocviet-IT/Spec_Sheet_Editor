import Link from "next/link";
import type { Profile } from "@/auth/access";
import type { Messages } from "@/messages";
import { fill } from "@/messages/format";
import { AccountMenu } from "./account-menu";
import { FeedbackButton } from "./feedback-button";
import { LanguageSwitch } from "./language-switch";
import { Logo } from "./logo";
import { NavTabs } from "./nav-tabs";
import { ThemeMenu } from "./theme-menu";

/**
 * One bar on a desktop: brand, page tabs, then the report button, the language switch, the theme menu and the account menu.
 * On a phone the tabs move to a second, horizontally scrollable row and the language switch and the theme choice move into the
 * account menu.
 */
export function AppHeader({ me, t, feedbackUnseen = 0 }: { me: Profile; t: Messages; feedbackUnseen?: number }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:flex-nowrap md:gap-x-4">
        <Link href="/sheets" className="flex min-w-0 items-center gap-2 font-bold tracking-tight">
          <Logo size={28} />
          <span className="truncate">{t.app.name}</span>
        </Link>
        <div className="order-last w-full md:order-none md:w-auto">
          <NavTabs
            isAdmin={me.role === "admin"}
            feedbackUnseen={feedbackUnseen}
            labels={{
              mainMenu: t.common.mainMenu,
              sheets: t.common.sheets,
              guide: t.common.guide,
              feedback: t.common.feedback,
              admin: t.common.admin,
              waiting: fill(t.feedback.waiting, { n: feedbackUnseen }),
            }}
          />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <FeedbackButton />
          <div className="max-md:hidden">
            <LanguageSwitch />
          </div>
          <div className="max-md:hidden">
            <ThemeMenu />
          </div>
          <AccountMenu name={me.fullName} email={me.email} role={me.role} passwordAccount={me.passwordAccount} />
        </div>
      </div>
    </header>
  );
}
