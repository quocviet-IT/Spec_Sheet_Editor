/**
 * A report's own address is stored by the app, but a link is only drawn for a path inside this site.
 * Browsers drop tabs and newlines inside an address, so any control character is refused outright.
 */
export function isLocalPath(url: string): boolean {
  if (!url.startsWith("/") || url.startsWith("//")) return false;
  if (/[\u0000-\u001f\u007f]/.test(url) || url.includes("\\")) return false;
  try {
    return new URL(url, "http://local.invalid").origin === "http://local.invalid";
  } catch {
    return false;
  }
}

/** A report moved since the reader last looked: it was triaged, and either they never looked or it was after that. */
export function isUpdated(triagedAt: string | null, seenAt: string | null): boolean {
  if (!triagedAt) return false;
  if (!seenAt) return true;
  const triaged = new Date(triagedAt).getTime();
  const seen = new Date(seenAt).getTime();
  if (Number.isNaN(triaged)) return false;
  if (Number.isNaN(seen)) return true;
  return triaged > seen;
}
