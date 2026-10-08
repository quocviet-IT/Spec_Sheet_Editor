import type { SourceType } from "@/lib/form/template";

export function fileLabel(sourceType: SourceType, width: number, height: number): string {
  return `${sourceType.toUpperCase()} · ${width} × ${height}`;
}

/** The file name without its extension (UC-03; a name is 1–200 characters). */
export function defaultSheetName(fileName: string, fallback: string): string {
  const base = fileName.replace(/\.[^.]*$/, "").trim();
  return (base || fallback).slice(0, 200);
}
