import { cn } from "@/lib/utils";

// The PrepHub mark — a home roofline over an open book, matching the
// logomark used on the PrepHub YouTube channel (a house-shape containing a
// book: "your home base for learning"). Single-color line art via
// currentColor so it can render in either brand color depending on context
// (cream on a teal surface, teal on a cream surface).
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={cn("size-6", className)}
      aria-hidden="true"
    >
      <path
        d="M9 33 L32 11 L55 33"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 30 C19 30 24 26.5 32 30 C40 26.5 45 30 45 30 L45 44 C45 44 40 40.5 32 44 C24 40.5 19 44 19 44 Z"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M32 30 L32 44" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const LOGO_SIZES = {
  default: { icon: "size-6", text: "text-lg" },
  lg: { icon: "size-8", text: "text-2xl" },
} as const;

// The full lockup — mark + wordmark in the brand display face. Used in the
// app header and anywhere the product name needs real visual weight (auth
// screens, empty states); bare "PrepHub" text elsewhere stays on the body
// font so it doesn't compete with real headings.
export function Logo({ className, size = "default" }: { className?: string; size?: keyof typeof LOGO_SIZES }) {
  const { icon, text } = LOGO_SIZES[size];
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={cn(icon, "text-primary")} />
      <span className={cn("font-brand font-medium tracking-tight text-foreground", text)}>PrepHub</span>
    </span>
  );
}
