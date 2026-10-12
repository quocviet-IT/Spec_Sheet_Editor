"use client";

import { History, ShieldCheck, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMessages } from "@/messages/client";

/**
 * The four Admin areas as icon tabs. A nav named "Admin sections"; the current area carries aria-current="page"
 * and an accent underline. Icons are decorative (18 px).
 */
export function AdminTabs() {
  const t = useMessages();
  const pathname = usePathname();
  const items = [
    { href: "/admin/users", label: t.admin.areas.users, icon: Users },
    { href: "/admin/access", label: t.admin.areas.access, icon: ShieldCheck },
    { href: "/admin/audit", label: t.admin.areas.audit, icon: History },
    { href: "/admin/trash", label: t.admin.areas.cleanup, icon: Trash2 },
  ];
  return (
    <nav aria-label={t.admin.nav} className="mb-6 flex flex-wrap gap-1 border-b border-line text-sm">
      {items.map(({ href, label, icon: Icon }) => {
        const current = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 ${current ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
