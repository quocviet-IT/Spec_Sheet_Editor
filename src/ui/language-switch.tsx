"use client";

import { setLocale } from "@/messages/actions";
import { useLocale, useMessages } from "@/messages/client";
import { LOCALE_LABEL, LOCALE_SHORT, LOCALES } from "@/messages/locale";

/**
 * VI | EN as one segmented control. Each option is a real form posting to a server action, so it works without
 * JavaScript too. The "menu" variant adds the label in front, for the account menu on a phone.
 */
export function LanguageSwitch({ variant = "bar" }: { variant?: "bar" | "menu" }) {
  const current = useLocale();
  const t = useMessages();
  const group = (
    <div
      role="group"
      aria-label={t.common.language}
      className="inline-flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5 text-xs"
    >
      {LOCALES.map((locale) => (
        <form key={locale} action={setLocale}>
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            title={LOCALE_LABEL[locale]}
            aria-current={locale === current ? "true" : undefined}
            {...(variant === "menu"
              ? { role: "menuitemradio", "aria-checked": locale === current, tabIndex: -1 }
              : {})}
            className={
              "min-h-6 rounded px-2 font-semibold tracking-wider " +
              (locale === current ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-sunk hover:text-ink")
            }
          >
            {LOCALE_SHORT[locale]}
          </button>
        </form>
      ))}
    </div>
  );
  if (variant === "bar") return group;
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-ink-2">
      <span>{t.common.language}</span>
      {group}
    </div>
  );
}
