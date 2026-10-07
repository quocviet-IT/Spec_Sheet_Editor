import type { ClickReading } from "../click";
import { rectCentre, type Point } from "../geometry";
import type { Detection } from "../scan";
import { NEAR_PX, SAMPLE_TRUTH, type TruthValue } from "./sample";

const near = (c: Point, t: TruthValue) => Math.abs(c.x - t.x) <= NEAR_PX && Math.abs(c.y - t.y) <= NEAR_PX;

export type ScanScore = { located: number; read: number; stray: number; rows: { key: string; detection: Detection | null }[] };

/** The bake-off's metrics (research/ocr-bakeoff/metrics.py): located, read correctly, and stray readings. */
export function scoreScan(detections: readonly Detection[], truth: readonly TruthValue[] = SAMPLE_TRUTH): ScanScore {
  const rows = truth.map((t) => {
    const nearby = detections.filter((d) => near(rectCentre(d.box), t));
    return { key: t.key, detection: nearby.find((d) => d.value === t.value) ?? nearby[0] ?? null };
  });
  return {
    located: rows.filter((r) => r.detection !== null).length,
    read: rows.filter((r, i) => r.detection?.value === truth[i].value).length,
    stray: detections.filter((d) => !truth.some((t) => near(rectCentre(d.box), t))).length,
    rows,
  };
}

export type ClickRow = { key: string; reading: ClickReading | null; ms: number };

export function scoreClicks(rows: readonly ClickRow[], truth: readonly TruthValue[] = SAMPLE_TRUTH): { correct: number; slowestMs: number } {
  return {
    correct: rows.filter((r, i) => r.reading?.value === truth[i].value).length,
    slowestMs: Math.max(0, ...rows.map((r) => r.ms)),
  };
}
