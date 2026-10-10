export type ScanFile = { path: string; text: string };
export type Needle = { label: string; value: string };
export type Leak = { label: string; path: string };

/** Which needles appear in which files. Pure; an empty needle never matches, so an unset variable is harmless. */
export function findLeaks(files: ScanFile[], needles: Needle[]): Leak[] {
  const leaks: Leak[] = [];
  for (const file of files) {
    for (const needle of needles) {
      if (needle.value !== "" && file.text.includes(needle.value)) leaks.push({ label: needle.label, path: file.path });
    }
  }
  return leaks;
}
