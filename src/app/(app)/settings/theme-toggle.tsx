"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

// next-themes reads the persisted theme from localStorage synchronously on
// the client's first render (by design, to avoid a flash of the wrong
// theme) — which means `theme` genuinely differs between the server render
// and the client's very first render, and directly comparing it during
// render would cause a real hydration mismatch (confirmed via a dev warning
// while building this). useSyncExternalStore's getServerSnapshot/getSnapshot
// split is the React-idiomatic fix: false during SSR and client hydration,
// true immediately after — without calling setState inside an effect.
function subscribe() {
  return () => {};
}
function useHasMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

// PRD-010 §8 — Light/Dark/System, applied across the entire platform.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hasMounted = useHasMounted();

  return (
    <div role="radiogroup" aria-label="Appearance" className="flex gap-2">
      {OPTIONS.map((opt) => {
        const isSelected = hasMounted && theme === opt.value;
        return (
          <Button
            key={opt.value}
            type="button"
            size="sm"
            variant={isSelected ? "default" : "outline"}
            role="radio"
            aria-checked={isSelected}
            onClick={() => setTheme(opt.value)}
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}
