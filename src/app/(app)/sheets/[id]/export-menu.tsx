"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useMessages } from "@/messages/client";

type Props = { disabled: boolean; onChoose: (format: "png" | "pdf") => void };

/** The toolbar Export button and its two-item menu (UC-09, UC-10). */
export function ExportMenu({ disabled, onChoose }: Props) {
  const t = useMessages();
  const e = t.editor.export;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);

  // An open menu: focus its first item, close on a press outside it.
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPress = (ev: PointerEvent) => {
      const target = ev.target as Node;
      if (button.current?.contains(target)) return; // the button toggles its own menu
      if (!menu.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPress);
    return () => document.removeEventListener("pointerdown", onPress);
  }, [open]);

  const shown = open && !disabled;

  function onKey(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    ev.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = ev.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[to].focus();
  }

  function choose(format: "png" | "pdf") {
    setOpen(false);
    button.current?.focus(); // the dialog that opens remembers this button and gives focus back to it
    onChoose(format);
  }

  return (
    <div className="relative">
      <button
        type="button"
        ref={button}
        aria-haspopup="menu"
        aria-expanded={shown}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50"
      >
        {e.button}
      </button>
      {shown ? (
        <div
          ref={menu}
          role="menu"
          aria-label={e.menu}
          onKeyDown={onKey}
          onBlur={(ev) => {
            const to = ev.relatedTarget as Node | null;
            if (to && !ev.currentTarget.contains(to) && to !== button.current) setOpen(false);
          }}
          className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-line bg-surface py-1 shadow-lg"
        >
          <button type="button" role="menuitem" onClick={() => choose("png")} className="block w-full px-3 py-2 text-left text-sm hover:bg-sunk">{e.png}</button>
          <button type="button" role="menuitem" onClick={() => choose("pdf")} className="block w-full px-3 py-2 text-left text-sm hover:bg-sunk">{e.pdf}</button>
        </div>
      ) : null}
    </div>
  );
}
