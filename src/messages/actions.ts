"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, parseTheme } from "@/ui/theme";
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

/** Choose light, dark or system mode. Same shape as setLocale: the layout reads the cookie to set <html data-theme>. */
export async function setTheme(form: FormData): Promise<void> {
  const theme = parseTheme(form.get("theme"));
  const store = await cookies();
  store.set(THEME_COOKIE, theme, { path: "/", maxAge: THEME_COOKIE_MAX_AGE, sameSite: "lax" });
  revalidatePath("/", "layout");
}
