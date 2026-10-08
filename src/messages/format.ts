/** Fills `{name}` placeholders in dictionary strings. Unknown names stay visible, so a missing value shows. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}
