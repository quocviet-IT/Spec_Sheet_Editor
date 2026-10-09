"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMessages } from "@/messages/client";

export function AdminNav() {
  const t = useMessages();
  const pathname = usePathname();
  const items = [
    { href: "/admin/users", label: t.admin.areas.users },
    { href: "/admin/access", label: t.admin.areas.access },
    { href: "/admin/audit", label: t.admin.areas.audit },
    { href: "/admin/trash", label: t.admin.areas.cleanup },
  ];
  return (
    <nav aria-label={t.admin.nav} className="mb-6 flex flex-wrap gap-1 border-b border-line text-sm">
      {items.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 ${current ? "border-ink font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
