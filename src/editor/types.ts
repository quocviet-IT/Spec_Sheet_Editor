/**
 * Design section 6.3. Positions are fractions of the trimmed page, so they hold at any resolution:
 * `cx` of the page width, `cy` of the page height, and both sizes `w`, `h` of the page WIDTH (a box may
 * be turned, so its sides can lie along either axis). `angle` is the reading direction in degrees in page
 * coordinates (y down), the angle canvas `rotate()` takes: 0 = left to right, -90 = vertical read
 * bottom-up, 90 = vertical read top-down. `w` lies along the reading direction, `h` across it.
 */
export type Box = { cx: number; cy: number; w: number; h: number };

export type DetectionSource = "pdf-text" | "ocr" | "click" | "manual";

export type Detection = {
  id: string;
  box: Box;
  angle: number;
  /** Machine reading, may be wrong (BR-04). */
  readValue: string | null;
  /** 0–100, informational only. */
  confidence: number | null;
  source: DetectionSource;
};

export type Edit = {
  detectionId: string;
  /** Confirmed by the person (BR-04). */
  oldValue: string;
  /** Normalised (BR-05), e.g. "2.60". */
  newValue: string;
  box: Box;
  angle: number;
  /** Digit height, fraction of the page width. */
  fontPx: number;
  textColor: string;
  bgColor: string;
};

/** A box in pixels of the trimmed page, with its angle (same meaning as above). */
export type PxBox = { cx: number; cy: number; w: number; h: number; angle: number };

export type Panel = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
