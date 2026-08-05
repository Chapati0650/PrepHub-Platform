"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

// PRD-010 §8 — Light/Dark/System, applied across the entire platform.
// next-themes stamps the resolved theme as a class on <html> and persists the
// choice in localStorage; the CSS variables for both palettes already exist
// in globals.css (`.dark` variant), so this is purely the toggle mechanism.
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
