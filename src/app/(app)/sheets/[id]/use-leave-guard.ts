"use client";

import { useEffect } from "react";

/** The part of the Navigation API this guard uses (Chrome and Edge, NFR-06); TypeScript's DOM library lacks it. */
type NavigateEvent = Event & { navigationType: string; cancelable: boolean; destination: { key: string } };
type NavigationApi = EventTarget & { traverseTo(key: string): unknown };

/** After the person chooses to leave, the traversal they asked for is not asked about a second time. */
const BYPASS_MS = 1000;

/**
 * UC-08 exception *a (F-16, TC-39): with unsaved changes, closing or reloading the tab asks through the
 * browser, and a click on an in-app link asks first. The listener runs in the capture phase on the
 * document, before Next.js's link handler, and stops the navigation when the person cancels. Back and
 * Forward ask through the Navigation API, and so does a form that leaves the screen (Sign out); the
 * language switch and the forms inside the editor (marked `data-editor-root`) do not.
 */
export function useLeaveGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return;
    let bypass = false;
    let bypassTimer: number | undefined;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return; // a full page load: beforeunload asks
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    function onSubmit(e: SubmitEvent) {
      const form = e.target;
      if (!(form instanceof HTMLFormElement) || e.defaultPrevented) return;
      if (form.closest("[data-editor-root]") || form.querySelector("input[name='locale']")) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    const navigation = "navigation" in window ? ((window as unknown as { navigation: NavigationApi }).navigation) : null;
    function onNavigate(event: Event) {
      const e = event as NavigateEvent;
      if (bypass) {
        bypass = false;
        return;
      }
      // A traversal across documents cannot be cancelled; beforeunload asks for that one.
      if (e.navigationType !== "traverse" || !e.cancelable) return;
      e.preventDefault();
      if (window.confirm(message)) {
        bypass = true;
        window.clearTimeout(bypassTimer);
        bypassTimer = window.setTimeout(() => (bypass = false), BYPASS_MS);
        const key = e.destination.key;
        // After this event has finished: a traversal started inside the handler of another one is dropped.
        window.setTimeout(() => {
          try {
            const result = navigation?.traverseTo(key) as { committed?: Promise<unknown>; finished?: Promise<unknown> } | undefined;
            result?.committed?.catch(() => {});
            result?.finished?.catch(() => {});
          } catch {
            bypass = false;
          }
        }, 0);
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    navigation?.addEventListener("navigate", onNavigate);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      navigation?.removeEventListener("navigate", onNavigate);
      window.clearTimeout(bypassTimer);
    };
  }, [active, message]);
}
