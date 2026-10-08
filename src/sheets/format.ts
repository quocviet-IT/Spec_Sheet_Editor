import type { SourceType } from "@/lib/form/template";
import type { Locale } from "@/messages/locale";

export const TIME_ZONE = "Asia/Ho_Chi_Minh";

export function fileLabel(sourceType: SourceType, width: number, height: number): string {
  return `${sourceType.toUpperCase()} · ${width} × ${height}`;
}

/** The file name without its extension (UC-03; a name is 1–200 characters). */
export function defaultSheetName(fileName: string, fallback: string): string {
  const base = fileName.replace(/\.[^.]*$/, "").trim();
  return (base || fallback).slice(0, 200);
}

/** "14:05" in the company's time zone (UC-08 step 4). */
export function clockTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE,
  }).format(new Date(iso));
}
