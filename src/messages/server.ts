import "server-only";
import { cookies } from "next/headers";
import { getDictionary, type Messages } from "./index";
import { LOCALE_COOKIE, parseLocale, type Locale } from "./locale";

/** Locale of the current request. Next de-duplicates cookies() within a request, so call it anywhere. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value);
}

export async function getMessages(): Promise<Messages> {
  return getDictionary(await getLocale());
}
