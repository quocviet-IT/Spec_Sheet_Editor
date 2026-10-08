import type { Edit } from "./types";

/** The mask reaches this far beyond the digits (share of the digit height, at least 1 px). */
export const MASK_PAD = 0.15;

/** One edit in pixels of the page, in the frame centred on the value and turned to its angle. */
export type EditPlan = {
  cx: number;
  cy: number;
  rad: number;
  maskW: number;
  maskH: number;
  fontSize: number;
  /** Where the baseline sits across the text, from the centre (towards the digits' foot). */
  baseline: number;
  text: string;
  textColor: string;
  bgColor: string;
};

/**
 * UC-05 step 5: mask the old digits with the paper colour, then draw the new value centred on the same
 * box at the same angle and digit height. `digitAscentEm` is Arimo's digit height per em, measured in the
 * browser, so the new digits are exactly as tall as the old ones.
 */
export function planEdit(edit: Edit, pageW: number, pageH: number, digitAscentEm: number): EditPlan {
  const w = edit.box.w * pageW;
  const h = edit.box.h * pageW;
  const pad = Math.max(1, MASK_PAD * h);
  const digitPx = edit.fontPx * pageW;
  return {
    cx: edit.box.cx * pageW,
    cy: edit.box.cy * pageH,
    rad: (edit.angle * Math.PI) / 180,
    maskW: w + 2 * pad,
    maskH: h + 2 * pad,
    fontSize: digitPx / digitAscentEm,
    baseline: digitPx / 2,
    text: edit.newValue,
    textColor: edit.textColor,
    bgColor: edit.bgColor,
  };
}
