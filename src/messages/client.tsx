"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getDictionary, type Messages } from "./index";
import { DEFAULT_LOCALE, type Locale } from "./locale";

/** Only the locale code crosses to the browser; both dictionaries are already in the bundle. */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useMessages(): Messages {
  const locale = useContext(LocaleContext);
  return useMemo(() => getDictionary(locale), [locale]);
}
