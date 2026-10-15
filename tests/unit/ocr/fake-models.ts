import { buildAlphabet } from "@/lib/ocr/alphabet";
import type { OcrModels, Tensor } from "@/lib/ocr/pipeline";

const chars = buildAlphabet("1\n6\n.\n3\n0\n9\n8\n7\nL\n");

/**
 * Where the fake detector sees text: a block centred at (cx, cy), `w` long and `h` thick, all as fractions
 * of the detector's input (cx and w of its width, cy and h of its height), turned `degrees` (y down).
 */
export type FakeBlock = { cx: number; cy: number; w: number; h: number; degrees?: number };

/**
 * Models for the real pipeline (`readRegion`): the detector sees one block in every image that `sees`
 * accepts, and the recogniser gives `reads` in order, one per call, then nothing it would keep.
 */
export function fakeModels(
  reads: readonly { text: string; score: number }[],
  { block = { cx: 0.5, cy: 0.5, w: 0.4, h: 0.2 }, sees = () => true }: { block?: FakeBlock; sees?: (width: number, height: number) => boolean } = {},
): OcrModels & { recCalls: number } {
  const spell = (text: string) => [...text].flatMap((ch) => [chars.indexOf(ch), 0]);
  const fake = {
    chars,
    recCalls: 0,
    async detect(input: Tensor): Promise<Tensor> {
      const [, , h, w] = input.dims;
      const data = new Float32Array(w * h);
      if (sees(w, h)) {
        const a = ((block.degrees ?? 0) * Math.PI) / 180;
        const [cx, cy, half, thick] = [block.cx * w, block.cy * h, (block.w * w) / 2, (block.h * h) / 2];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const along = (x - cx) * Math.cos(a) + (y - cy) * Math.sin(a);
            const across = -(x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
            if (Math.abs(along) < half && Math.abs(across) < thick) data[y * w + x] = 0.9;
          }
        }
      }
      return { data, dims: [1, 1, h, w] };
    },
    async recognize(input: Tensor): Promise<Tensor> {
      const { text, score } = reads[fake.recCalls] ?? { text: "", score: 0.1 };
      fake.recCalls++;
      const n = input.dims[0];
      const steps = spell(text);
      const length = Math.max(1, steps.length);
      const data = new Float32Array(n * length * chars.length);
      for (let b = 0; b < n; b++) steps.forEach((c, t) => (data[(b * length + t) * chars.length + c] = c === 0 ? 0.9 : score));
      return { data, dims: [n, length, chars.length] };
    },
  };
  return fake;
}
