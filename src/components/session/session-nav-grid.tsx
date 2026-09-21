"use client";

import { useEffect, useRef } from "react";

export type NavItemState = "current" | "submitted" | "skipped" | "unanswered";

// PRD-012 §17 — must clearly identify current/answered/unanswered/skipped
// questions. Color is never the sole indicator (WCAG 2.1 AA): each state also
// gets a distinct border style and an accessible label.
//
// On a phone the 21 cells used to wrap into three rows and take the top
// third of the screen before the question appeared. Below `sm` it is now
// one horizontally scrolling row that keeps the current question in view;
// the full wrapped grid remains from `sm` up.
export function SessionNavGrid({
  items,
  onSelect,
}: {
  items: { position: number; state: NavItemState }[];
  onSelect: (position: number) => void;
}) {
  const currentRef = useRef<HTMLButtonElement | null>(null);
  const current = items.find((i) => i.state === "current")?.position;
  useEffect(() => {
    currentRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [current]);

  return (
    <div role="group" aria-label="Question navigator" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
      {items.map((item) => (
        <button
          key={item.position}
          ref={item.state === "current" ? currentRef : undefined}
          type="button"
          onClick={() => onSelect(item.position)}
          aria-label={`Question ${item.position + 1}, ${stateLabel(item.state)}`}
          aria-current={item.state === "current" ? "step" : undefined}
          className={[
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-xs font-medium transition-colors",
            item.state === "current" && "border-2 border-primary bg-primary/10 text-primary",
            item.state === "submitted" && "border-2 border-green-600 bg-green-100 text-green-800 dark:border-green-500 dark:bg-green-900/50 dark:text-green-300",
            item.state === "skipped" &&
              "border-amber-500 border-dashed bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
            item.state === "unanswered" && "border-border text-muted-foreground",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {item.position + 1}
        </button>
      ))}
    </div>
  );
}

function stateLabel(state: NavItemState): string {
  switch (state) {
    case "current":
      return "current question";
    case "submitted":
      return "answered";
    case "skipped":
      return "skipped";
    case "unanswered":
      return "not answered";
  }
}
