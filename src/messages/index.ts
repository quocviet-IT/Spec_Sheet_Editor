import { vi } from "./vi";
import { en } from "./en";
import type { Locale } from "./locale";

/**
 * `vi` is declared `as const`, so `typeof vi` holds the literal Vietnamese strings. Loosen every leaf to
 * `string` but keep the key set: `en` must then have exactly the same keys or the build fails.
 */
type Loosen<T> = { [K in keyof T]: T[K] extends string ? string : Loosen<T[K]> };

export type Messages = Loosen<typeof vi>;

const DICTIONARIES: Record<Locale, Messages> = { vi, en };

export function getDictionary(locale: Locale): Messages {
  return DICTIONARIES[locale] ?? vi;
}

export { vi, en };
export type { Locale };
