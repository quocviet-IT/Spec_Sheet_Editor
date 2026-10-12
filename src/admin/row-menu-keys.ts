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

/**
 * What an open row menu does on a scroll or resize event: "ignore" for a scroll that happens inside the menu itself,
 * "close-and-refocus" when focus is in the menu (so it goes back to the menu button, like Esc), otherwise "close".
 */
export function dismissAction(kind: "scroll" | "resize", targetInsideMenu: boolean, focusInsideMenu: boolean): "ignore" | "close" | "close-and-refocus" {
  if (kind === "scroll" && targetInsideMenu) return "ignore";
  return focusInsideMenu ? "close-and-refocus" : "close";
}
