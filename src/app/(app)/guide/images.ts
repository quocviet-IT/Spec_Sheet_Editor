import type { StaticImageData } from "next/image";
import type { Locale } from "@/messages";
import type { ShotName } from "./content";

import vi_login from "./shots/vi/login.jpg";
import vi_list from "./shots/vi/list.jpg";
import vi_upload from "./shots/vi/upload.jpg";
import vi_editor from "./shots/vi/editor.jpg";
import vi_popover from "./shots/vi/popover.jpg";
import vi_drawBox from "./shots/vi/draw-box.jpg";
import vi_exportCheck from "./shots/vi/export-check.jpg";
import vi_adminUsers from "./shots/vi/admin-users.jpg";
import vi_adminTrash from "./shots/vi/admin-trash.jpg";
import en_login from "./shots/en/login.jpg";
import en_list from "./shots/en/list.jpg";
import en_upload from "./shots/en/upload.jpg";
import en_editor from "./shots/en/editor.jpg";
import en_popover from "./shots/en/popover.jpg";
import en_drawBox from "./shots/en/draw-box.jpg";
import en_exportCheck from "./shots/en/export-check.jpg";
import en_adminUsers from "./shots/en/admin-users.jpg";
import en_adminTrash from "./shots/en/admin-trash.jpg";

/** The screenshots with their real sizes (the page reads the aspect ratio from the file, so a shot may be any shape). */
export const IMAGES: Record<Locale, Record<ShotName, StaticImageData>> = {
  vi: {
    "login": vi_login,
    "list": vi_list,
    "upload": vi_upload,
    "editor": vi_editor,
    "popover": vi_popover,
    "draw-box": vi_drawBox,
    "export-check": vi_exportCheck,
    "admin-users": vi_adminUsers,
    "admin-trash": vi_adminTrash,
  },
  en: {
    "login": en_login,
    "list": en_list,
    "upload": en_upload,
    "editor": en_editor,
    "popover": en_popover,
    "draw-box": en_drawBox,
    "export-check": en_exportCheck,
    "admin-users": en_adminUsers,
    "admin-trash": en_adminTrash,
  },
};
