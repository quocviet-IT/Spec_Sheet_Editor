"use client";

import { setLocale } from "@/messages/actions";
import { useLocale, useMessages } from "@/messages/client";
import { LOCALE_LABEL, LOCALE_SHORT, LOCALES } from "@/messages/locale";

/** VI / EN. Each option is a real form posting to a server action, so it works without JavaScript too. */
export function LanguageSwitch() {
  const current = useLocale();
  const t = useMessages();
  return (
    <div role="group" aria-label={t.common.language} className="flex items-center gap-1 text-xs">
      {LOCALES.map((locale) => (
        <form key={locale} action={setLocale}>
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            title={LOCALE_LABEL[locale]}
            aria-current={locale === current ? "true" : undefined}
            className={
              "rounded px-2 py-1 font-semibold tracking-wider " +
              (locale === current ? "bg-accent-soft text-accent" : "text-ink-3 hover:text-ink")
            }
          >
            {LOCALE_SHORT[locale]}
          </button>
        </form>
      ))}
    </div>
  );
}
