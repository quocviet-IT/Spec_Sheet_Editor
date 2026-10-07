/**
 * The recogniser's alphabet: index 0 is the CTC blank and the last entry a space, around the lines of
 * the model's keys file (RapidOCR CTCLabelDecode).
 */
export function buildAlphabet(keys: string): string[] {
  const lines = keys.split("\n").map((line) => line.replace(/\r$/, ""));
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return ["blank", ...lines, " "];
}
