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
 * A value with what is written in front of it ("Ø" + "1.40"), as it is shown and drawn. A stored ⌀ is drawn
 * as Ø, which the shipped Arimo has (NFR-05: never a system font).
 */
export function withPrefix(prefix: string | undefined, value: string): string {
  return `${(prefix ?? "").replace(/⌀/g, "Ø")}${value}`;
}

/**
 * UC-05 step 5: mask the old digits with the paper colour, then draw the new value centred on the same
 * box at the same angle and digit height, with the value's prefix in front of it in the same font and
 * height (the box, and so the mask, holds the old prefix too). `digitAscentEm` is Arimo's digit height per
 * em, measured in the browser, so the new digits are exactly as tall as the old ones.
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
    text: withPrefix(edit.prefix, edit.newValue),
    textColor: edit.textColor,
    bgColor: edit.bgColor,
  };
}
