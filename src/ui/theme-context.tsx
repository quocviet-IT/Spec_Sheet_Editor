"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Theme } from "./theme";

/** Only the theme name crosses to the browser; the server has already applied it to <html data-theme>. */
const ThemeContext = createContext<Theme>("system");

export function ThemeProvider({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
