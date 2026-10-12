/** Brand colours of the logo. Fixed: they do not change in dark mode. */
export const LOGO_COLORS = {
  tile: "#1d6b4b",
  ring: "#ffffff",
  measure: "#9fe1cb",
} as const;

export type LogoVariant = "detailed" | "simple";
export type Stroke = { d: string; strokeWidth: number };

export type LogoShapes = {
  variant: LogoVariant;
  ring: { cx: number; cy: number; r: number; strokeWidth: number };
  stone: string;
  /** Measure line, end arrowheads and extension ticks (one line when simple). */
  measure: Stroke[];
};

/** From 32 px up the detailed mark is legible; below it the simplified one is used. */
export function logoVariant(size: number): LogoVariant {
  return size >= 32 ? "detailed" : "simple";
}

export function logoShapes(size: number): LogoShapes {
  const variant = logoVariant(size);
  if (variant === "simple") {
    return {
      variant,
      ring: { cx: 32, cy: 35, r: 15, strokeWidth: 5 },
      stone: "M27 17l5-6 5 6z",
      measure: [{ d: "M14 35h36", strokeWidth: 3.5 }],
    };
  }
  return {
    variant,
    ring: { cx: 32, cy: 35, r: 15, strokeWidth: 4 },
    stone: "M27 16.5l5-6 5 6z",
    measure: [
      { d: "M17 35h30", strokeWidth: 2.5 },
      { d: "M20.5 32l-3.5 3 3.5 3M43.5 32l3.5 3-3.5 3", strokeWidth: 2 },
      { d: "M12 31v8M52 31v8", strokeWidth: 2.5 },
    ],
  };
}
