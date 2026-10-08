import { resizeBilinear, type Raster } from "./raster";

export const REC_HEIGHT = 48;
const REC_MIN_RATIO = 320 / 48;
/** RapidOCR rec_batch_num. */
export const REC_BATCH = 6;

export type RecResult = { text: string; score: number };

/**
 * One recogniser batch (RapidOCR resize_norm_img): every crop resized to 48 px high, normalised to
 * [-1, 1] in B, G, R order, and zero-padded on the right to the batch width.
 */
export function recBatch(crops: readonly Raster[]): { data: Float32Array; dims: [number, 3, number, number] } {
  const maxRatio = Math.max(REC_MIN_RATIO, ...crops.map((c) => c.width / c.height));
  const batchW = Math.trunc(REC_HEIGHT * maxRatio);
  const plane = REC_HEIGHT * batchW;
  const data = new Float32Array(crops.length * 3 * plane);
  crops.forEach((crop, n) => {
    const resizedW = Math.min(batchW, Math.max(1, Math.ceil(REC_HEIGHT * (crop.width / crop.height))));
    const img = resizeBilinear(crop, resizedW, REC_HEIGHT);
    const base = n * 3 * plane;
    for (let y = 0; y < REC_HEIGHT; y++) {
      for (let x = 0; x < resizedW; x++) {
        const p = (y * resizedW + x) * 4;
        const o = y * batchW + x;
        data[base + o] = (img.data[p + 2] / 255 - 0.5) / 0.5;
        data[base + plane + o] = (img.data[p + 1] / 255 - 0.5) / 0.5;
        data[base + 2 * plane + o] = (img.data[p] / 255 - 0.5) / 0.5;
      }
    }
  });
  return { data, dims: [crops.length, 3, REC_HEIGHT, batchW] };
}

/**
 * Greedy CTC decoding of the recogniser's softmax output [n, steps, classes]: take the likeliest class
 * per step, collapse repeats, drop blanks (class 0). The score is the mean probability of the kept steps.
 */
export function ctcDecode(probs: Float32Array, dims: readonly number[], chars: readonly string[]): RecResult[] {
  const [n, steps, classes] = dims;
  if (classes !== chars.length) throw new Error(`The model has ${classes} classes but the alphabet has ${chars.length}.`);
  const results: RecResult[] = [];
  for (let b = 0; b < n; b++) {
    let text = "";
    let sum = 0;
    let kept = 0;
    let previous = -1;
    for (let t = 0; t < steps; t++) {
      const base = (b * steps + t) * classes;
      let best = 0;
      let bestP = probs[base];
      for (let c = 1; c < classes; c++) {
        if (probs[base + c] > bestP) {
          bestP = probs[base + c];
          best = c;
        }
      }
      if (best !== 0 && best !== previous) {
        text += chars[best];
        sum += bestP;
        kept++;
      }
      previous = best;
    }
    results.push({ text, score: kept > 0 ? sum / kept : 0 });
  }
  return results;
}
