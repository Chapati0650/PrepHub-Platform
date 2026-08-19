import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

// Shared quiet icon-badge treatment (bg-accent teal wash, monochrome icon) —
// used for a step/screen's single visual anchor (Onboarding wizard, Diagnostic
// intro screens), a smaller inline row icon (preview lists in both of those
// flows), and a hero-scale variant (a single-fact intro screen with no other
// content — the icon needs to carry real visual weight, same size-contrast
// idea CLAUDE.md uses for the Score Prediction hero number, rather than a
// small badge floating in mostly-empty space). One definition so the sizes
// can't drift apart.
const SIZES = {
  sm: { box: "size-9", icon: "size-4.5", radius: "rounded-lg" },
  lg: { box: "size-12", icon: "size-6", radius: "rounded-xl" },
  xl: { box: "size-20", icon: "size-10", radius: "rounded-2xl" },
} as const;

export function IconBadge({
  icon: Icon,
  size = "lg",
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  size?: "sm" | "lg" | "xl";
  className?: string;
}) {
  const { box, icon, radius } = SIZES[size];
  return (
    <div className={cn("inline-flex shrink-0 items-center justify-center bg-accent text-accent-foreground", box, radius, className)}>
      <Icon className={icon} aria-hidden />
    </div>
  );
}
