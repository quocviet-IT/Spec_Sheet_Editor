import { z } from "zod";
import type { Box, Detection, Edit } from "./types";

const fraction = z.number().min(0).max(1);
const size = z.number().gt(0).max(1);
const angle = z.number().gt(-180).lte(180);
/** A normalised value (BR-05): digits, at most one point, no comma. */
const value = z.string().regex(/^\d{1,3}(\.\d{1,3})?$/);
const colour = z.string().regex(/^#[0-9a-f]{6}$/);

export const MAX_VALUES = 300;

export const boxSchema = z.strictObject({ cx: fraction, cy: fraction, w: size, h: size }) satisfies z.ZodType<Box>;

export const detectionSchema = z.strictObject({
  id: z.string().min(1).max(64),
  box: boxSchema,
  angle,
  readValue: value.nullable(),
  confidence: z.number().min(0).max(100).nullable(),
  source: z.enum(["pdf-text", "ocr", "click", "manual"]),
}) satisfies z.ZodType<Detection>;

export const editSchema = z.strictObject({
  detectionId: z.string().min(1).max(64),
  oldValue: value,
  newValue: value,
  box: boxSchema,
  angle,
  fontPx: size,
  textColor: colour,
  bgColor: colour,
}) satisfies z.ZodType<Edit>;

/** The stored lists: unique ids, and every edit points at a listed value, once. */
export const sheetDataSchema = z
  .object({ detections: z.array(detectionSchema).max(MAX_VALUES), edits: z.array(editSchema).max(MAX_VALUES) })
  .superRefine((data, ctx) => {
    const ids = new Set<string>();
    for (const d of data.detections) {
      if (ids.has(d.id)) ctx.addIssue({ code: "custom", message: "duplicate value id" });
      ids.add(d.id);
    }
    const edited = new Set<string>();
    for (const e of data.edits) {
      if (!ids.has(e.detectionId)) ctx.addIssue({ code: "custom", message: "edit of an unknown value" });
      if (edited.has(e.detectionId)) ctx.addIssue({ code: "custom", message: "two edits of one value" });
      edited.add(e.detectionId);
    }
  });

/** `version` is a Postgres int: anything above its range is refused here, not by the database. */
export const saveInputSchema = z.object({ id: z.uuid(), version: z.number().int().min(1).max(2147483647), data: sheetDataSchema });
