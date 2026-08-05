"use client";

export type NavItemState = "current" | "submitted" | "skipped" | "unanswered";

// PRD-012 §17 — must clearly identify current/answered/unanswered/skipped
// questions. Color is never the sole indicator (WCAG 2.1 AA): each state also
// gets a distinct border style and an accessible label.
export function SessionNavGrid({
  items,
  onSelect,
}: {
  items: { position: number; state: NavItemState }[];
  onSelect: (position: number) => void;
}) {
  return (
    <div role="group" aria-label="Question navigator" className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <button
          key={item.position}
          type="button"
          onClick={() => onSelect(item.position)}
          aria-label={`Question ${item.position + 1}, ${stateLabel(item.state)}`}
          aria-current={item.state === "current" ? "step" : undefined}
          className={[
            "flex h-8 w-8 items-center justify-center rounded-md border text-xs font-medium transition-colors",
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
