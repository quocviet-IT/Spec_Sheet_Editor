"use client";

import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { nextMenuIndex } from "@/admin/row-menu-keys";
import { setTheme } from "@/messages/actions";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import type { Messages } from "@/messages";
import { THEMES, type Theme } from "./theme";
import { useTheme } from "./theme-context";

const ITEM = "[role^='menuitem']";

const ICON: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

function themeLabel(t: Messages, theme: Theme): string {
  return theme === "light" ? t.common.themeLight : theme === "dark" ? t.common.themeDark : t.common.themeSystem;
}

/**
 * The theme button (the icon of the current choice) and its menu of Light, Dark and System. Same menu button
 * pattern and keyboard behaviour as AccountMenu: Enter, Space or ArrowDown open on the first item, ArrowUp on the
 * last; inside, the arrows wrap and Home/End jump; Esc closes and refocuses the button, Tab closes, a click
 * outside closes. Each item is a real form posting to setTheme, so it works without JavaScript.
 */
export function ThemeMenu() {
  const t = useMessages();
  const current = useTheme();
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const startAt = useRef<"first" | "last">("first");

  const label = fill(t.common.themeButton, { choice: themeLabel(t, current) });
  const CurrentIcon = ICON[current];

  function items(): HTMLElement[] {
    return Array.from(menu.current?.querySelectorAll<HTMLElement>(ITEM) ?? []).filter((el) => el.getClientRects().length > 0);
  }

  function openMenu(at: "first" | "last") {
    startAt.current = at;
    setOpen(true);
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) button.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const list = items();
    (startAt.current === "last" ? list[list.length - 1] : list[0])?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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
    const list = items();
    const next = nextMenuIndex(list.indexOf(document.activeElement as HTMLElement), list.length, e.key);
    if (next === null) return;
    e.preventDefault();
    list[next]?.focus();
  }

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={() => (open ? close(true) : openMenu("first"))}
        onKeyDown={onButtonKeyDown}
        className="inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-sunk hover:text-ink aria-expanded:bg-sunk aria-expanded:text-ink"
      >
        <CurrentIcon size={18} aria-hidden="true" />
      </button>
      {/* Without JavaScript the button cannot open the menu, so the panel shows as it is. */}
      <noscript>
        {/* unlayered, so it outranks the layered `hidden` utility (an `!important` rule would lose to the base layer) */}
        <style>{"[data-theme-panel]{display:block}"}</style>
      </noscript>
      {/* Always in the page, hidden while closed, so its forms exist even before (or without) JavaScript. */}
      <div
        ref={menu}
        id={`${id}-menu`}
        data-theme-panel=""
        role="menu"
        aria-label={t.common.theme}
        onKeyDown={onMenuKeyDown}
        className={
          "absolute right-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg" +
          (open ? "" : " hidden")
        }
      >
        {THEMES.map((theme) => {
          const Icon = ICON[theme];
          return (
            <form key={theme} action={setTheme}>
              <input type="hidden" name="theme" value={theme} />
              <button
                type="submit"
                role="menuitemradio"
                aria-checked={theme === current}
                tabIndex={-1}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-sunk focus:bg-sunk focus:outline-none"
              >
                <Icon size={16} aria-hidden="true" className="shrink-0 text-ink-2" />
                <span className="flex-1">{themeLabel(t, theme)}</span>
                {theme === current && <Check size={16} aria-hidden="true" className="shrink-0 text-accent" />}
              </button>
            </form>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "Theme: Light | Dark | System" as a segmented control with its label, for the account menu on a phone.
 * Same shape as the menu variant of LanguageSwitch: three forms, each a menuitemradio.
 */
export function ThemeSwitch() {
  const current = useTheme();
  const t = useMessages();
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-ink-2">
      <span>{t.common.theme}</span>
      <div
        role="group"
        aria-label={t.common.theme}
        className="inline-flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5 text-xs"
      >
        {THEMES.map((theme) => (
          <form key={theme} action={setTheme}>
            <input type="hidden" name="theme" value={theme} />
            <button
              type="submit"
              role="menuitemradio"
              aria-checked={theme === current}
              aria-current={theme === current ? "true" : undefined}
              tabIndex={-1}
              className={
                "min-h-6 rounded px-2 font-semibold " +
                (theme === current ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-sunk hover:text-ink")
              }
            >
              {themeLabel(t, theme)}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
