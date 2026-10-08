type Matrix = [number, number, number, number, number, number];

/** A text run of a PDF page, in pixels of the rendered page before trimming. */
export type PageTextItem = {
  str: string;
  /**
   * The run's text matrix after the viewport transform: (a, b) along the text, (c, d) towards the top of
   * the glyphs (its length is the font size in pixels), (e, f) the start of the baseline; y points down.
   */
  transform: Matrix;
  /** Advance length along the text, in pixels. */
  width: number;
};

/** pdf.js `Util.transform`: the result applies `m2` first, then `m1`. */
export function multiply(m1: readonly number[], m2: readonly number[]): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** pdf.js `getTextContent().items` in rendered-page pixels; marked-content entries and blank runs are skipped. */
export function toPageText(items: readonly unknown[], viewportTransform: readonly number[], scale: number): PageTextItem[] {
  const out: PageTextItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item) || !("width" in item)) continue;
    const { str, transform, width } = item as { str: unknown; transform: unknown; width: unknown };
    if (typeof str !== "string" || !str.trim() || !Array.isArray(transform) || transform.length !== 6 || typeof width !== "number") continue;
    out.push({ str, transform: multiply(viewportTransform, transform as number[]), width: width * scale });
  }
  return out;
}
