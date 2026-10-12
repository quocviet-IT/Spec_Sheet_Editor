import type { LucideIcon } from "lucide-react";

/** For no rows and for no search match: a decorative icon, a one-line title and an optional hint. */
export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Icon size={20} aria-hidden="true" className="text-ink-3" />
      <p className="font-medium text-ink">{title}</p>
      {hint ? <p className="text-sm text-ink-2">{hint}</p> : null}
    </div>
  );
}
