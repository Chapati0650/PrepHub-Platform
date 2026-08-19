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
}: {
  min: number;
  max: number;
  label: string;
  className?: string;
}) {
  const left = ((min - SAT_SCALE_MIN) / (SAT_SCALE_MAX - SAT_SCALE_MIN)) * 100;
  const width = Math.max(((max - min) / (SAT_SCALE_MAX - SAT_SCALE_MIN)) * 100, 2);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-caption font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="font-heading text-hero font-semibold tabular-nums sm:text-hero-lg">
        {min}–{max}
      </p>
      <div className="relative h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className="absolute inset-y-0 rounded-full bg-primary"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
    </div>
  );
}
