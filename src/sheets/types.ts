import type { SourceType } from "@/lib/form/template";

export const PAGE_SIZE = 50;

export type SheetTab = "live" | "trash";
export type Cursor = { time: string; id: string };

export type SheetRow = {
  id: string;
  name: string;
  sourceType: SourceType;
  thumbUrl: string | null;
  pageW: number;
  pageH: number;
  editCount: number;
  version: number;
  updatedAt: string;
  updatedByName: string;
  deletedAt: string | null;
  deletedByName: string | null;
};

export type SheetPage = { rows: SheetRow[]; next: Cursor | null };

export type UploadSettings = { maxFileMb: number; lowresWarnPx: number; aspectTolerancePct: number };
