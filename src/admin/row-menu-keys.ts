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
