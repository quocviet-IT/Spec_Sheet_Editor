import type { Detection, Edit } from "@/editor/types";
import type { SourceType } from "@/lib/form/template";

export type SheetTab = "live" | "trash";

/** Whose sheets the list shows (Admins only): everyone's, the signed-in user's own, or one person's id. */
export type SheetOwner = "all" | "me" | string;

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
  createdByName: string;
  deletedAt: string | null;
  deletedByName: string | null;
};

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
  /** The creator's name when the sheet is someone else's (only an Admin can open it), else null. */
  uploadedBy: string | null;
};

export type SaveResult =
  | { ok: true; version: number; savedAt: string }
  | { error: "conflict"; byName: string | null; savedAt: string | null }
  | { error: "trashed" }
  | { error: "invalid" | "unknown" };

export type EditorState = { version: number; name: string; detections: Detection[]; edits: Edit[]; deleted: boolean };
