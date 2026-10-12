/**
 * The index of the item to focus after a key press inside an open row menu, or null when the key does not move.
 * ArrowDown and ArrowUp wrap around the ends; Home and End jump. With no current item (-1),
 * ArrowDown lands on the first item and ArrowUp on the last.
 */
export function nextMenuIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export type ButtonRect = { top: number; bottom: number; left: number; right: number };

/**
 * What an open row menu does on a scroll or resize event: "ignore" for a scroll inside the menu itself,
 * "close" when its button is entirely outside the viewport, otherwise "reposition" so the menu follows the button.
 * A scroll that happens just before or after the menu opens therefore never closes it while the button is visible.
 */
export function menuReaction(
  kind: "scroll" | "resize",
  targetInsideMenu: boolean,
  rect: ButtonRect,
  viewport: { width: number; height: number },
): "ignore" | "reposition" | "close" {
  if (kind === "scroll" && targetInsideMenu) return "ignore";
  const offscreen = rect.bottom <= 0 || rect.top >= viewport.height || rect.right <= 0 || rect.left >= viewport.width;
  return offscreen ? "close" : "reposition";
}

/** Initials for an avatar: the first letters of the first and last word of the name (or of the email name when there is no name). */
export function initials(name: string | null | undefined, email: string): string {
  const source = (name ?? "").trim() || email.split("@")[0];
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0] ?? "?"];
  return letters.map((w) => Array.from(w)[0] ?? "").join("").toUpperCase();
}
