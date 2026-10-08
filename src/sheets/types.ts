import type { Detection, Edit } from "@/editor/types";
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

/** One sheet as the editor opens it (UC-05 – UC-08). */
export type EditorSheet = {
  id: string;
  name: string;
  sourceType: SourceType;
  pageW: number;
  pageH: number;
  version: number;
  detections: Detection[];
  edits: Edit[];
  deleted: boolean;
  /** The stored lists did not parse; the editor must not open (a save would wipe them). */
  broken: boolean;
  sourceUrl: string | null;
  lowRes: boolean;
};

export type SaveResult =
  | { ok: true; version: number; savedAt: string }
  | { error: "conflict"; byName: string | null; savedAt: string | null }
  | { error: "trashed" }
  | { error: "invalid" | "unknown" };

export type EditorState = { version: number; detections: Detection[]; edits: Edit[]; deleted: boolean };
