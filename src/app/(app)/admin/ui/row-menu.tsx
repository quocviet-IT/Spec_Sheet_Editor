"use client";

import { Ellipsis, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { menuReaction, nextMenuIndex } from "@/admin/row-menu-keys";

export type RowMenuItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Called after the menu has closed and focus is back on the button, which is passed so a dialog can return focus to it. */
  onSelect: (opener: HTMLElement) => void;
  tone?: "danger";
  separatorBefore?: boolean;
};

const ITEM_HEIGHT = 36; // px, used only to decide whether the menu fits below the button
const MENU_PADDING = 8;
const MENU_GAP = 4;

type Place = { right: number; top?: number; bottom?: number };

/**
 * A "..." button that opens a menu of actions, following the WAI-ARIA menu button pattern.
 *
 * Button: aria-haspopup="menu", aria-expanded, and aria-controls (set while the menu exists, so it never points
 * at a missing element); `label` is its accessible name, e.g. "Actions for {name}".
 * Keys: Enter, Space (the button's own click) or ArrowDown open on the first item; ArrowUp opens on the last.
 * Inside: ArrowUp/ArrowDown move and wrap, Home/End jump, Esc closes and refocuses the button, Tab closes and
 * lets focus move on from the button, a click outside closes. Selecting an item closes the menu, focuses the
 * button, then calls onSelect(button).
 *
 * Positioning: the menu is rendered in a portal on document.body with position: fixed, right-aligned under the
 * button, and opens upwards when there is not room below. Why a portal and not an absolutely positioned child:
 * an Admin table sits in an overflow-x-auto wrapper, which clips (and scrolls) any absolute child that sticks out
 * of it, so the menu of the last rows would be cut off. A fixed portal is outside every overflow ancestor. Because
 * a fixed menu does not follow its button, it is repositioned on scroll and on resize, and closes (like Esc) only
 * when its button is entirely out of the viewport.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place>({ right: 0, top: 0 });
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const startAt = useRef<"first" | "last">("first");

  function placeFor(rect: DOMRect): Place {
    const need = items.length * ITEM_HEIGHT + MENU_PADDING;
    const below = window.innerHeight - rect.bottom;
    const right = document.documentElement.clientWidth - rect.right;
    return below < need && rect.top > below
      ? { right, bottom: window.innerHeight - rect.top + MENU_GAP }
      : { right, top: rect.bottom + MENU_GAP };
  }

  function openMenu(at: "first" | "last") {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setPlace(placeFor(rect));
    startAt.current = at;
    setOpen(true);
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) button.current?.focus();
  }

  // Focus the first or last item as soon as the menu exists.
  useEffect(() => {
    if (!open) return;
    const list = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    (startAt.current === "last" ? list[list.length - 1] : list[0])?.focus();
  }, [open]);

  // Outside click closes; scroll and resize keep the menu under its button, and close it only when the button is off-screen.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menu.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    }
    function follow(kind: "scroll" | "resize") {
      return (e: Event) => {
        const el = menu.current;
        const btn = button.current;
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        const action = menuReaction(kind, e.target instanceof Node && !!el?.contains(e.target), rect, {
          width: document.documentElement.clientWidth,
          height: window.innerHeight,
        });
        if (action === "ignore") return;
        if (action === "reposition") {
          setPlace(placeFor(rect));
          return;
        }
        if (el?.contains(document.activeElement)) btn.focus({ preventScroll: true });
        setOpen(false);
      };
    }
    const onScroll = follow("scroll");
    const onResize = follow("resize");
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  function onButtonKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openMenu(e.key === "ArrowUp" ? "last" : "first");
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      close(true); // no preventDefault: focus then moves on from the button
      return;
    }
    const list = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    const next = nextMenuIndex(list.indexOf(document.activeElement as HTMLButtonElement), list.length, e.key);
    if (next === null) return;
    e.preventDefault();
    list[next]?.focus();
  }

  function select(item: RowMenuItem) {
    setOpen(false);
    const opener = button.current;
    opener?.focus();
    if (opener) item.onSelect(opener);
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => (open ? close(true) : openMenu("first"))}
        onKeyDown={onButtonKeyDown}
        className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-sunk hover:text-ink aria-expanded:bg-sunk aria-expanded:text-ink"
      >
        <Ellipsis size={16} aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              id={`${id}-menu`}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKeyDown}
              style={{ position: "fixed", right: place.right, top: place.top, bottom: place.bottom }}
              className="z-50 w-56 rounded-md border border-line bg-surface py-1 shadow-lg"
            >
              {items.map((item, i) => (
                <Fragment key={item.key}>
                  {item.separatorBefore ? <div role="separator" className="my-1 border-t border-line" /> : null}
                  <button
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => select(item)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-sunk focus:bg-sunk focus:outline-none ${item.tone === "danger" ? "text-danger" : "text-ink"}`}
                  >
                    <item.icon size={16} aria-hidden="true" className="shrink-0" />
                    {item.label}
                  </button>
                </Fragment>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
