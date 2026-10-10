import type { Messages } from "@/messages";

/** The screenshots, in page order. Each exists as public/guide/<locale>/<name>.jpg with callout points in points.json. */
export const SHOTS = ["login", "list", "upload", "editor", "popover", "draw-box", "export-check", "admin-users", "admin-trash"] as const;
export type ShotName = (typeof SHOTS)[number];

export type StepKey = keyof Messages["guide"]["steps"];
/** A step; with `n` it points at callout number n of the block's screenshot. */
export type Step = { key: StepKey; n?: number };
/** A screenshot with its numbered steps, or steps on their own. */
export type Block = { shot?: ShotName; steps: Step[] };

export const SECTION_IDS = ["signin", "upload", "find", "edit", "save", "export", "shortcuts", "trouble", "admin"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** Sections with steps. `shortcuts` and `trouble` are tables and have no blocks. */
export const BLOCKS: Record<SectionId, Block[]> = {
  signin: [
    {
      shot: "login",
      steps: [
        { key: "signinEmail", n: 1 },
        { key: "signinPassword", n: 2 },
        { key: "signinSubmit", n: 3 },
        { key: "signinLanguage", n: 4 },
        { key: "signinForced" },
        { key: "signinChange" },
      ],
    },
  ],
  upload: [
    {
      shot: "upload",
      steps: [
        { key: "uploadOpen" },
        { key: "uploadChoose" },
        { key: "uploadChecks", n: 1 },
        { key: "uploadPages", n: 2 },
        { key: "uploadLowRes" },
        { key: "uploadName", n: 3 },
        { key: "uploadStart", n: 4 },
      ],
    },
  ],
  find: [
    {
      shot: "list",
      steps: [
        { key: "findUpload", n: 1 },
        { key: "findSearch", n: 2 },
        { key: "findTrash", n: 3 },
        { key: "findMenu", n: 4 },
        { key: "findRestore" },
      ],
    },
  ],
  edit: [
    {
      shot: "editor",
      steps: [
        { key: "editMarkers", n: 1 },
        { key: "editList", n: 2 },
        { key: "editDrawButton", n: 3 },
        { key: "editZoom", n: 4 },
        { key: "editLocked" },
        { key: "editDesktop" },
      ],
    },
    {
      shot: "popover",
      steps: [
        { key: "editClick" },
        { key: "editOld", n: 1 },
        { key: "editNew", n: 2 },
        { key: "editApply", n: 3 },
        { key: "editRevert", n: 4 },
        { key: "editMatch" },
      ],
    },
    {
      shot: "draw-box",
      steps: [
        { key: "editClickRead" },
        { key: "editDraw" },
        { key: "editAngle", n: 1 },
        { key: "editFree", n: 2 },
        { key: "editContinue", n: 3 },
      ],
    },
    { steps: [{ key: "editRename" }] },
  ],
  save: [
    {
      steps: [
        { key: "saveStore" },
        { key: "saveConflict" },
        { key: "saveOffline" },
        { key: "saveLeave" },
      ],
    },
  ],
  export: [
    {
      shot: "export-check",
      steps: [
        { key: "exportOpen" },
        { key: "exportList", n: 1 },
        { key: "exportReminder", n: 2 },
        { key: "exportStart", n: 3 },
        { key: "exportBack", n: 4 },
        { key: "exportFile" },
        { key: "exportNotStored" },
      ],
    },
  ],
  shortcuts: [],
  trouble: [],
  admin: [
    {
      shot: "admin-users",
      steps: [
        { key: "adminUsersAdd", n: 1 },
        { key: "adminUsersSearch", n: 2 },
        { key: "adminUsersRole", n: 3 },
        { key: "adminUsersSuspend", n: 4 },
        { key: "adminUsersReset", n: 5 },
      ],
    },
    {
      steps: [{ key: "adminAccess" }, { key: "adminSettings" }, { key: "adminAudit" }],
    },
    {
      shot: "admin-trash",
      steps: [
        { key: "adminTrashDelete", n: 1 },
        { key: "adminTrashOrphans", n: 2 },
      ],
    },
  ],
};

/** The keyboard table, taken from the key handlers under src/app/(app)/sheets. Each row: alternatives, each a chord of key caps. */
export type ShortcutKey = keyof Messages["guide"]["shortcuts"]["rows"];
export const SHORTCUTS: { id: ShortcutKey; keys: string[][] }[] = [
  { id: "save", keys: [["Ctrl", "S"]] },
  { id: "draw", keys: [["K"]] },
  { id: "escape", keys: [["Esc"]] },
  { id: "zoomIn", keys: [["+"], ["="]] },
  { id: "zoomOut", keys: [["-"]] },
  { id: "zoomFit", keys: [["0"]] },
  { id: "next", keys: [["Tab"]] },
  { id: "open", keys: [["Enter"]] },
  { id: "tabs", keys: [["←"], ["→"], ["Home"], ["End"]] },
  { id: "menus", keys: [["↑"], ["↓"]] },
];

/** The five likeliest messages. The text of each is quoted from the dictionaries on the page itself. */
export const TROUBLE_IDS = ["template", "tooLarge", "reader", "conflict", "suspended"] as const;
export type TroubleId = (typeof TROUBLE_IDS)[number];

/** Alt-text key of each shot (hyphenated shot names are not valid property shorthand). */
export function altOf(t: Messages, shot: ShotName): string {
  return t.guide.alt[shot];
}

/** Callout numbers a block uses. */
export function calloutNumbers(block: Block): number[] {
  return block.steps.flatMap((s) => (s.n === undefined ? [] : [s.n]));
}
