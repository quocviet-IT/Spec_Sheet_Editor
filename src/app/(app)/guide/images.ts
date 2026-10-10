import type { StaticImageData } from "next/image";
import type { Locale } from "@/messages";
import type { ShotName } from "./content";

import vi_login from "../../../../public/guide/vi/login.jpg";
import vi_list from "../../../../public/guide/vi/list.jpg";
import vi_upload from "../../../../public/guide/vi/upload.jpg";
import vi_editor from "../../../../public/guide/vi/editor.jpg";
import vi_popover from "../../../../public/guide/vi/popover.jpg";
import vi_drawBox from "../../../../public/guide/vi/draw-box.jpg";
import vi_exportCheck from "../../../../public/guide/vi/export-check.jpg";
import vi_adminUsers from "../../../../public/guide/vi/admin-users.jpg";
import vi_adminTrash from "../../../../public/guide/vi/admin-trash.jpg";
import en_login from "../../../../public/guide/en/login.jpg";
import en_list from "../../../../public/guide/en/list.jpg";
import en_upload from "../../../../public/guide/en/upload.jpg";
import en_editor from "../../../../public/guide/en/editor.jpg";
import en_popover from "../../../../public/guide/en/popover.jpg";
import en_drawBox from "../../../../public/guide/en/draw-box.jpg";
import en_exportCheck from "../../../../public/guide/en/export-check.jpg";
import en_adminUsers from "../../../../public/guide/en/admin-users.jpg";
import en_adminTrash from "../../../../public/guide/en/admin-trash.jpg";

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
