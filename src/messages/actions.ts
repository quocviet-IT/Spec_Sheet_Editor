"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, parseLocale } from "./locale";

/**
 * Switch the interface language. Written on the server (not document.cookie) because server components
 * read the language from the request cookie; revalidate the whole layout because every page changes.
 */
export async function setLocale(form: FormData): Promise<void> {
  const locale = parseLocale(form.get("locale"));
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: "lax" });
  revalidatePath("/", "layout");
}
