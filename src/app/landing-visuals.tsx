"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";

function VisualCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">{children}</div>;
}

// useSyncExternalStore, not useState+useEffect: the repo's
// react-hooks/set-state-in-effect lint rule flags synchronous setState in an
// effect body (see CLAUDE.md's next-themes hydration gotcha for the same
// pattern) — this subscribes to the media query directly instead, with a
// server snapshot of `false` since motion preference is unknown pre-hydration.
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

// The 7 fixed PrepHub categories (CLAUDE.md) — same labels used everywhere
// else in the app (src/lib/content/labels.ts's CATEGORY_LABELS).
const CATEGORIES = [
  "Reading Comprehension",
  "Grammar",
  "Vocabulary",
  "Algebra",
  "Geometry & Trig",
  "Advanced Math",
  "Problem Solving & Data Analysis",
];

const CHECK_INTERVAL_MS = 500;
const HOLD_AFTER_REVEAL_MS = 2600;

// Loops: checks off each category in turn, reveals a Predicted SAT Score,
// holds, then resets — dramatizing "one Diagnostic → one prediction" rather
// than the previous grid of blank squares, which didn't tie back to anything
// a visitor could recognize from the product description next to it.
export function DiagnosticVisual() {
  const reducedMotion = usePrefersReducedMotion();
  const [checked, setChecked] = useState(reducedMotion ? CATEGORIES.length : 0);
  const revealed = checked === CATEGORIES.length;

  useEffect(() => {
    if (reducedMotion) return;
    const timer = setTimeout(
      () => setChecked((c) => (c === CATEGORIES.length ? 0 : c + 1)),
      revealed ? HOLD_AFTER_REVEAL_MS : CHECK_INTERVAL_MS,
    );
    return () => clearTimeout(timer);
  }, [checked, revealed, reducedMotion]);

  return (
    <VisualCard>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Diagnostic</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {checked} of {CATEGORIES.length} categories
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-2.5">
        {CATEGORIES.map((label, i) => {
          const done = i < checked;
          return (
            <div key={label} className="flex items-center gap-2.5 text-sm">
              <span
                className={`flex size-4.5 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 ${
                  done ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}
              >
                {done && <Check className="size-3" strokeWidth={3} aria-hidden />}
              </span>
              <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
            </div>
          );
        })}
      </div>
      <div
        className={`mt-4 overflow-hidden rounded-lg border border-border bg-muted/40 transition-all duration-500 ${
          revealed ? "max-h-20 p-3 opacity-100" : "max-h-0 p-0 opacity-0"
        }`}
      >
        <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Predicted SAT Score</p>
        <p className="font-heading text-xl font-semibold tabular-nums">1420–1480</p>
      </div>
    </VisualCard>
  );
}

const MASTERY_ROWS = [
  { label: "Algebra", before: 58, after: 78 },
  { label: "Reading Comprehension", before: 38, after: 54 },
  { label: "Advanced Math", before: 44, after: 61 },
];

const MASTERY_CYCLE_MS = 2800;

// Loops each bar between a "before" and "after" mastery value so the visual
// itself demonstrates adaptiveness, rather than sitting at one static state.
export function MasteryVisual() {
  const reducedMotion = usePrefersReducedMotion();
  const [improved, setImproved] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => setImproved((v) => !v), MASTERY_CYCLE_MS);
    return () => clearInterval(timer);
  }, [reducedMotion]);

  return (
    <VisualCard>
      <div className="flex flex-col gap-4">
        {MASTERY_ROWS.map((row) => {
          const value = improved ? row.after : row.before;
          return (
            <div key={row.label}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span>{row.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{value}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-in-out"
                  style={{ width: `${value}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div
        className={`mt-4 flex items-center gap-1 text-sm font-medium text-achievement-foreground transition-opacity duration-500 dark:text-achievement ${
          improved ? "opacity-100" : "opacity-0"
        }`}
      >
        ↑ Mastery improving with every set
      </div>
    </VisualCard>
  );
}
