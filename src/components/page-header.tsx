import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared page-title chrome, reused across every authenticated page (student,
// admin, owner). Second revision: the icon lost its solid-teal badge square
// and the eyebrow lost its teal tint — color is reserved for whatever the
// page's actual primary action or hero number is, not spent by default on
// every page's header. Title uses the named type-scale tokens (globals.css)
// instead of a page-picked text-3xl/4xl, so the hierarchy is enforced by the
// token, not by each call site guessing a size.
export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  className,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex items-center gap-3">
        {Icon && <Icon className="size-6 shrink-0 text-muted-foreground" aria-hidden />}
        <div>
          {eyebrow && <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">{eyebrow}</p>}
          <h1 className="text-page-title sm:text-page-title-lg">{title}</h1>
          {description && <p className="mt-1 text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
