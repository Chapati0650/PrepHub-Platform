import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared page-title chrome, reused across every authenticated page (student,
// admin, owner).
//
// Third revision: the decorative icon is gone entirely, not just de-emphasized.
// A Lucide glyph sitting beside every single page title is one of the clearest
// "generated app" tells — it carries no information the title doesn't already
// carry, and repeating it on 17 pages makes every page read at the same weight.
// (Second revision had already dropped the icon's solid-teal badge and the
// eyebrow's teal tint for the same reason; this finishes that move.) The rule
// underneath now does the work the icon was pretending to do: it separates the
// header from the page without adding a second thing to look at.
//
// Title uses the named type-scale tokens (globals.css) instead of a page-picked
// text-3xl/4xl, so hierarchy is enforced by the token, not by each call site
// guessing a size.
export function PageHeader({
  eyebrow,
  title,
  description,
  className,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</p>
        )}
        <h1 className={cn("text-page-title sm:text-page-title-lg", eyebrow && "mt-1.5")}>{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
