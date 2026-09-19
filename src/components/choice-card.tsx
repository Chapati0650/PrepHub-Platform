import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

// For genuine "pick one path" decision moments (access method, onboarding
// choices) — never reused as a general info box the way Card is. The entire
// surface is the single click target (a Link, not a button-inside-a-div), so
// there's nothing nested to compete with it. Reserve `tone="primary"` for the
// one recommended path per decision; every other option stays `"neutral"` —
// that's how a set of choices can carry equal structural weight (same size,
// same click target) while still reading as visually hierarchical, since
// tone conveys emphasis and layout conveys equal reachability.
//
// No leading icon any more. A muted Lucide glyph beside each option was the
// same decorative-tile tell CLAUDE.md lists first, and it carried nothing the
// title didn't. The arrow on the right is the one graphic: it is the
// affordance ("this goes somewhere"), and it fills on hover so the whole card
// reads as one button. `meta` is for a single line of hard fact under the
// description — a price, a count — never a slogan.
export function ChoiceCard({
  href,
  title,
  description,
  meta,
  tone = "neutral",
  className,
}: {
  href: string;
  title: ReactNode;
  description: ReactNode;
  meta?: ReactNode;
  tone?: "primary" | "neutral";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-5 rounded-2xl border-2 p-6 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        tone === "primary"
          ? "border-primary bg-surface-tint hover:bg-accent"
          : "border-border hover:border-foreground/30 hover:bg-muted/40",
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-heading text-xl font-semibold tracking-tight">{title}</span>
        <span className="mt-1 block text-muted-foreground">{description}</span>
        {meta && (
          <span className={cn("mt-3 block text-sm font-medium", tone === "primary" ? "text-primary" : "text-foreground")}>
            {meta}
          </span>
        )}
      </span>
      <span
        aria-hidden
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full border transition-colors",
          tone === "primary"
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border text-muted-foreground group-hover:border-foreground group-hover:bg-foreground group-hover:text-background",
        )}
      >
        <ArrowRight className="size-5" />
      </span>
    </Link>
  );
}
