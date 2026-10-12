import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AdminCrumb } from "./admin-crumb";

/**
 * The top of an Admin page: breadcrumb "Admin > {title}", an h1 with a decorative icon, a one-line lead and an
 * optional primary action on the right. It holds no hooks, so server pages can use it (the icon is a component and
 * cannot cross into a client component); the breadcrumb text is the only client part.
 * Accessibility: the icon is aria-hidden, and the page has exactly one h1.
 */
export function PageHeader({ icon: Icon, title, lead, action }: { icon: LucideIcon; title: string; lead: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <AdminCrumb title={title} />
        <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
          <Icon size={20} aria-hidden="true" className="shrink-0 text-accent" />
          {title}
        </h1>
        <p className="text-sm text-ink-2">{lead}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
