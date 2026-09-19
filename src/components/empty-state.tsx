import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared "nothing here yet" pattern, reused across every authenticated page.
//
// The icon is deliberately *not* a filled badge tile anymore. A solid-teal
// rounded square with a white glyph in it, repeated at the center of every
// empty state, was the single most-repeated element in the app and read as
// stock-generated chrome — it drew the eye to the one place on the page with
// nothing to say. Now the tile is gone, the glyph is muted and small, and the
// panel is a flat tint rather than a dashed outline: an empty state should
// recede until the student has done something, then disappear.
//
// The `icon` prop stays required because every existing call site already
// passes a well-chosen one, and it still earns its place at this weight — it
// just no longer outranks the words next to it.
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
    <div className={cn("flex flex-col items-start gap-1.5 rounded-2xl bg-surface-tint p-6", className)}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="font-medium">{title}</p>
      </div>
      {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
