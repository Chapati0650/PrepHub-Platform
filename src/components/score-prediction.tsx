import { cn } from "@/lib/utils";

const SAT_SCALE_MIN = 400;
const SAT_SCALE_MAX = 1600;

// The one deliberate "PrepHub signature" visual moment — reused identically
// everywhere a predicted score range appears (dashboard, session results) so
// it reads as a consistent, recognizable product element rather than a
// generic "big bold number in a bordered card." The thin bar beneath the
// number is a literal miniature number line showing where the range sits on
// the real 400-1600 SAT scale — a small, meaningful motif tied to what the
// number actually represents, not decoration for its own sake.
export function ScorePrediction({
  min,
  max,
  label,
  className,
  fit = false,
}: {
  min: number;
  max: number;
  label: string;
  className?: string;
  /** Size the number to this component's own width instead of the fixed hero
   *  scale, never above it. The dashboard's score card is ~320px inside at
   *  every desktop width, which broke "1130–1200" across two lines. With
   *  `fit` the component is its own size container, so its width must come
   *  from its parent (a stretched flex child or a block), never from its
   *  content: in a content-sized row (session results) it would collapse. */
  fit?: boolean;
}) {
  const left = ((min - SAT_SCALE_MIN) / (SAT_SCALE_MAX - SAT_SCALE_MIN)) * 100;
  // A typical 60-80 point range is only ~5% of the 1200-point scale, so the
  // filled span is genuinely tiny — confirmed by screenshot, where it read as
  // a stray dash rather than a position on a line. The floor is what keeps it
  // legible as a marker; it overstates the range's width at the narrowest
  // predictions, which is the right trade for a decorative scale whose actual
  // numbers are printed directly above it.
  const width = Math.max(((max - min) / (SAT_SCALE_MAX - SAT_SCALE_MIN)) * 100, 4);

  return (
    <div className={cn("flex flex-col gap-2", fit && "@container", className)}>
      <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "font-heading font-semibold tracking-tight tabular-nums",
          fit ? "text-[length:clamp(2.25rem,17cqi,var(--text-hero-lg))] whitespace-nowrap" : "text-hero sm:text-hero-lg",
        )}
      >
        {min}–{max}
      </p>
      {/* The scale keeps its 400/1600 end labels so the bar reads as a real
          number line rather than an abstract progress meter — without them a
          viewer has no way to know the filled span means "where this range
          sits on the SAT scale" and not "how far along you are." */}
      <div className="w-full max-w-72">
        {/* bg-foreground/10, not bg-muted: this component renders on a tinted
            panel as often as on plain card white, and a neutral-gray track
            disappears against the teal wash. A translucent black works on
            both grounds and in dark mode. */}
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden>
          <div
            className="absolute inset-y-0 rounded-full bg-primary"
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-caption tabular-nums text-muted-foreground" aria-hidden>
          <span>{SAT_SCALE_MIN}</span>
          <span>{SAT_SCALE_MAX}</span>
        </div>
      </div>
    </div>
  );
}
