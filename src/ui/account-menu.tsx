"use client";

import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { initials, nextMenuIndex } from "@/admin/row-menu-keys";
import { signOut } from "@/auth/actions";
import { useMessages } from "@/messages/client";
import { fill } from "@/messages/format";
import { LanguageSwitch } from "./language-switch";

const ITEM = "[role^='menuitem']";

/**
 * The account button (initials avatar) and its menu: who is signed in, Change password (password accounts only),
 * the language switch on a phone, and Sign out. Follows the WAI-ARIA menu button pattern like RowMenu:
 * Enter, Space or ArrowDown open on the first item, ArrowUp on the last; inside, the arrows wrap and Home/End
 * jump; Esc closes and refocuses the button, Tab closes, a click outside closes.
 *
 * The panel is absolutely positioned under the button (the header has no overflow clipping), so opening it never
 * moves the page.
 */
export function AccountMenu({
  name,
  email,
  role,
  passwordAccount,
}: {
  name: string | null;
  email: string;
  role: "admin" | "user";
  passwordAccount: boolean;
}) {
  const t = useMessages();
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const startAt = useRef<"first" | "last">("first");

  const shownName = name?.trim() || email;

  function items(): HTMLElement[] {
    // An item inside a display:none block (the language switch on desktop) has no layout box: skip it.
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

  const itemClass =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-sunk focus:bg-sunk focus:outline-none";

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={fill(t.common.account, { name: shownName })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => (open ? close(true) : openMenu("first"))}
        onKeyDown={onButtonKeyDown}
        className="inline-flex items-center gap-1 rounded-full p-0.5 pr-1.5 text-ink-2 hover:bg-sunk hover:text-ink aria-expanded:bg-sunk aria-expanded:text-ink"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-8 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold tracking-wide text-accent"
        >
          {initials(name, email)}
        </span>
        <ChevronDown size={16} aria-hidden="true" className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {open && (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-label={fill(t.common.account, { name: shownName })}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          <div role="none" className="flex items-center gap-3 border-b border-line px-3 py-3">
            <span
              aria-hidden="true"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
            >
              {initials(name, email)}
            </span>
            <div role="none" className="min-w-0">
              <div role="none" className="truncate font-medium text-ink">{shownName}</div>
              <div role="none" className="truncate text-sm text-ink-2" title={email}>{email}</div>
              <span
                role="none"
                className={
                  "mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium " +
                  (role === "admin" ? "bg-admin-soft text-admin" : "bg-sunk text-ink-2")
                }
              >
                {role === "admin" ? t.common.roleAdmin : t.common.roleStaff}
              </span>
            </div>
          </div>
          <div role="none" className="border-b border-line py-1 md:hidden">
            <LanguageSwitch variant="menu" />
          </div>
          {passwordAccount && (
            <Link
              href="/account/password"
              role="menuitem"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className={`${itemClass} text-ink`}
            >
              <KeyRound size={16} aria-hidden="true" className="shrink-0" />
              {t.common.changePassword}
            </Link>
          )}
          <div role="separator" className="my-1 border-t border-line" />
          <form action={signOut}>
            <button type="submit" role="menuitem" tabIndex={-1} className={`${itemClass} text-danger`}>
              <LogOut size={16} aria-hidden="true" className="shrink-0" />
              {t.common.signOut}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
