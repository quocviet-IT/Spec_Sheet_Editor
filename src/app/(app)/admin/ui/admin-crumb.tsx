"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMessages } from "@/messages/client";

/** "Admin > {title}": "Admin" links to the Admin index, and the current page is marked aria-current="page". */
export function AdminCrumb({ title }: { title: string }) {
  const t = useMessages();
  return (
    <p className="flex items-center gap-1 text-sm text-ink-2">
      <Link href="/admin" className="hover:text-ink hover:underline">{t.admin.ui.breadcrumb}</Link>
      <ChevronRight size={16} aria-hidden="true" />
      <span aria-current="page">{title}</span>
    </p>
  );
}
