"use client";

import { useEffect } from "react";

/**
 * UC-08 exception *a (F-16, TC-39): with unsaved changes, closing or reloading the tab asks through the
 * browser, and a click on an in-app link asks first. The listener runs in the capture phase on the
 * document, before Next.js's link handler, and stops the navigation when the person cancels.
 */
export function useLeaveGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return;
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
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active, message]);
}
