import { dbPostprocess, detInputSize } from "./det";
import { pyRound, type Quad } from "./geometry";
import { createRaster, cropQuad, cropTurnsQuarter, resizeBilinear, rotate180, toBgrCHW, type Raster } from "./raster";
import { ctcDecode, recBatch, REC_BATCH, type RecResult } from "./rec";

export type Tensor = { data: Float32Array; dims: readonly number[] };

/** The two models behind the pipeline; the Worker backs this with onnxruntime-web, tests with fakes. */
export type OcrModels = {
  detect(input: Tensor): Promise<Tensor>;
  recognize(input: Tensor): Promise<Tensor>;
  chars: readonly string[];
};

/**
 * One text line. `quad` is in input pixels. `turn` is the extra counter-clockwise turn readRegion applied
 * to the crop before reading it: 90 for a tall crop, plus 180 when the upside-down reading won.
 */
export type Reading = { text: string; score: number; quad: Quad; turn: 0 | 90 | 180 | 270 };
/**
 * bothDirections: also read each crop upside down. With accept, only crops whose upright reading is not
 * accepted are re-read, and the upside-down reading wins when it is accepted or more confident.
 */
export type RegionReader = (
  models: OcrModels,
  image: Raster,
  opts?: { bothDirections?: boolean; accept?: (text: string) => boolean },
) => Promise<Reading[]>;

/** RapidOCR Global.text_score. */
export const MIN_TEXT_SCORE = 0.5;

/** RapidOCR's first step: longer side at most 2000 px, shorter at least 30 px, each a multiple of 32. */
export function fitWithinBounds(img: Raster, minSide = 30, maxSide = 2000): { raster: Raster; scaleX: number; scaleY: number } {
  let raster = img;
  let scaleX = 1;
  let scaleY = 1;
  const resize = (ratio: number) => {
    const w = pyRound(Math.trunc(raster.width * ratio) / 32) * 32;
    const h = pyRound(Math.trunc(raster.height * ratio) / 32) * 32;
    if (w <= 0 || h <= 0) throw new Error(`Cannot resize a ${raster.width}×${raster.height} image by ${ratio}.`);
    scaleX *= raster.width / w;
    scaleY *= raster.height / h;
    raster = resizeBilinear(raster, w, h);
  };
  if (Math.max(raster.width, raster.height) > maxSide) resize(maxSide / Math.max(raster.width, raster.height));
  if (Math.min(raster.width, raster.height) < minSide) resize(minSide / Math.min(raster.width, raster.height));
  return { raster, scaleX, scaleY };
}

/** Very wide or very short images get black bands above and below (RapidOCR apply_vertical_padding). */
export function padVertically(img: Raster, widthHeightRatio = 8, minHeight = 30): { raster: Raster; top: number } {
  if (img.height > minHeight && img.width / img.height <= widthHeightRatio) return { raster: img, top: 0 };
  const newHeight = Math.max(Math.trunc(img.width / widthHeightRatio), minHeight) * 2;
  const top = Math.trunc(Math.abs(newHeight - img.height) / 2);
  const out = createRaster(img.width, img.height + 2 * top, 0);
  out.data.set(img.data, top * img.width * 4);
  return { raster: out, top };
}

/** Reads crops in batches of similar width (RapidOCR sorts by aspect ratio); results keep the input order. */
export async function recognizeCrops(models: OcrModels, crops: readonly Raster[]): Promise<RecResult[]> {
  const order = crops.map((_, i) => i).sort((a, b) => crops[a].width / crops[a].height - crops[b].width / crops[b].height);
  const results: RecResult[] = new Array(crops.length);
  for (let start = 0; start < order.length; start += REC_BATCH) {
    const indices = order.slice(start, start + REC_BATCH);
    const output = await models.recognize(recBatch(indices.map((i) => crops[i])));
    ctcDecode(output.data, output.dims, models.chars).forEach((result, k) => {
      results[indices[k]] = result;
    });
  }
  return results;
}

/**
 * Detects and reads every text line in the image: RapidOCR's pipeline without the 180° classifier
 * (callers turn the image themselves). Quads are in input pixels; readings under MIN_TEXT_SCORE are
 * dropped. With bothDirections each crop is also read upside down (only those not accepted, when accept is given) and the better reading kept.
 */
export const readRegion: RegionReader = async (models, image, opts = {}) => {
  const fitted = fitWithinBounds(image);
  const padded = padVertically(fitted.raster);
  const size = detInputSize(padded.raster.width, padded.raster.height);
  const detImage = resizeBilinear(padded.raster, size.width, size.height);
  const prob = await models.detect({ data: toBgrCHW(detImage), dims: [1, 3, size.height, size.width] });
  const boxes = dbPostprocess(prob.data, prob.dims[3], prob.dims[2], padded.raster.width, padded.raster.height);
  if (boxes.length === 0) return [];

  const crops = boxes.map((box) => cropQuad(padded.raster, box.quad));
  const texts = await recognizeCrops(models, crops);
  const upsideDown = texts.map(() => false);
  if (opts.bothDirections) {
    const accept = opts.accept ?? (() => false);
    const retry = texts.flatMap((t, i) => (accept(t.text) ? [] : [i]));
    if (retry.length > 0) {
      const flipped = await recognizeCrops(models, retry.map((i) => rotate180(crops[i])));
      retry.forEach((i, k) => {
        if (accept(flipped[k].text) || flipped[k].score > texts[i].score) {
          texts[i] = flipped[k];
          upsideDown[i] = true;
        }
      });
    }
  }

  return boxes
    .map((box, i) => ({
      ...texts[i],
      turn: ((cropTurnsQuarter(box.quad) ? 90 : 0) + (upsideDown[i] ? 180 : 0)) as Reading["turn"],
      quad: box.quad.map((p) => ({ x: p.x * fitted.scaleX, y: (p.y - padded.top) * fitted.scaleY })) as Quad,
    }))
    .filter((reading) => reading.score >= MIN_TEXT_SCORE);
};
