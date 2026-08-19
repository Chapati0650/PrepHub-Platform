import type { ComponentType, ReactNode } from "react";
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
export function ChoiceCard({
  href,
  icon: Icon,
  title,
  description,
  tone = "neutral",
  className,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  description: ReactNode;
  tone?: "primary" | "neutral";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-start gap-4 rounded-lg border p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        tone === "primary"
          ? "border-primary/30 bg-accent/40 hover:border-primary/50 hover:bg-accent/60"
          : "border-border hover:border-foreground/20 hover:bg-muted/40",
        className
      )}
    >
      <Icon
        className={cn("size-5 shrink-0", tone === "primary" ? "text-primary" : "text-muted-foreground")}
        aria-hidden
      />
      <div className="flex-1">
        <p className="text-card-title font-heading font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <ArrowRight
        className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
