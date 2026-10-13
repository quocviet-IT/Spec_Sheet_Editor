"use client";

import { BookOpen, FileText, MessagesSquare, ShieldCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeTab, type HeaderTab } from "./active-tab";

export type NavTabLabels = {
  mainMenu: string;
  sheets: string;
  guide: string;
  feedback: string;
  admin: string;
  /** "{n} waiting", already filled for the current count. */
  waiting: string;
};

const ICONS: Record<HeaderTab, LucideIcon> = {
  sheets: FileText,
  guide: BookOpen,
  feedback: MessagesSquare,
  admin: ShieldCheck,
};

const HREF: Record<HeaderTab, string> = {
  sheets: "/sheets",
  guide: "/guide",
  feedback: "/feedback",
  admin: "/admin",
};

/** The header's page tabs; the one for the current page is highlighted and carries aria-current="page". */
export function NavTabs({
  isAdmin,
  feedbackUnseen,
  labels,
}: {
  isAdmin: boolean;
  feedbackUnseen: number;
  labels: NavTabLabels;
}) {
  const current = activeTab(usePathname());
  const tabs: HeaderTab[] = isAdmin ? ["sheets", "guide", "feedback", "admin"] : ["sheets", "guide", "feedback"];
  return (
    <nav aria-label={labels.mainMenu} className="min-w-0 max-md:w-full">
      <ul className="no-scrollbar flex items-center gap-1 whitespace-nowrap max-md:overflow-x-auto max-md:px-1 max-md:py-1">
        {tabs.map((tab) => {
          const Icon = ICONS[tab];
          const isCurrent = tab === current;
          return (
            <li key={tab} className="shrink-0">
              <Link
                href={HREF[tab]}
                aria-current={isCurrent ? "page" : undefined}
                className={
                  "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm " +
                  (isCurrent ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-sunk hover:text-ink")
                }
              >
                <Icon size={16} aria-hidden="true" className="shrink-0" />
                {labels[tab]}
                {tab === "feedback" && feedbackUnseen > 0 && (
                  <>
                    <span
                      aria-hidden="true"
                      className="inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-semibold leading-5 text-danger-ink"
                    >
                      {feedbackUnseen > 99 ? "99+" : feedbackUnseen}
                    </span>
                    <span className="sr-only">{labels.waiting}</span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
