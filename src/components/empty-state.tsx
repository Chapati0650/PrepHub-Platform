import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared "nothing here yet" pattern, reused across every authenticated page.
// Replaces the bare `rounded-lg border p-4 text-muted-foreground` boxes used
// everywhere for empty states, reusing the landing page's icon-badge idiom
// (src/app/page.tsx's FeatureRow icon treatment) instead of plain text alone.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-10 text-center",
        className,
      )}
    >
      <div className="inline-flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Icon className="size-6" />
      </div>
      <div>
        <p className="text-lg font-semibold">{title}</p>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
