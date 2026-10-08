/** Zoom levels besides Fit (section 8.4: `+` / `−` / `0`). */
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2] as const;

export type Zoom = number | "fit";

export function zoomIn(scale: number): number {
  return ZOOM_STEPS.find((s) => s > scale + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
}

export function zoomOut(scale: number): number {
  return [...ZOOM_STEPS].reverse().find((s) => s < scale - 1e-6) ?? ZOOM_STEPS[0];
}
