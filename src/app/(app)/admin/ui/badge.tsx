import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "admin";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-sunk text-ink-2",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warn-soft text-ink",
  danger: "bg-danger-soft text-danger",
  admin: "bg-admin-soft text-admin",
};

/**
 * A pill with an optional decorative icon and a text label. The text carries the meaning;
 * colour only reinforces it. All colours are tokens, so both themes are covered.
 */
export function Badge({ tone, icon: Icon, children }: { tone: BadgeTone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {/* 14 px on purpose: badges are 12 px text pills and 16 px would crowd them; the 16 px rule is for table cells and buttons. */}
      {Icon ? <Icon size={14} aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      {children}
    </span>
  );
}
