import type { LucideIcon } from "lucide-react";

/**
 * Two to four counters: a muted label with a decorative icon, and a large number. A description list
 * (term = label, description = number), so a screen reader reads "Active, 12".
 */
export function StatCards({ items }: { items: { icon: LucideIcon; label: string; value: number }[] }) {
  return (
    <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(({ icon: Icon, label, value }) => (
        <div key={label} className="rounded-lg border border-line bg-surface px-4 py-3">
          <dt className="flex items-center gap-2 text-sm text-ink-2">
            <Icon size={16} aria-hidden="true" />
            {label}
          </dt>
          <dd className="mt-1 text-2xl font-bold text-ink">{value.toLocaleString("en-US")}</dd>
        </div>
      ))}
    </dl>
  );
}
