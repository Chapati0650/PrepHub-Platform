import { cn } from "@/lib/utils";
import { FIT_LABEL, type Fit } from "@/lib/colleges/score-fit";

const MIN = 400;
const MAX = 1600;
const pct = (n: number) => ((n - MIN) / (MAX - MIN)) * 100;

// The same 400–1600 number line the dashboard draws under the Score
// Prediction, with two spans on it: the college's middle 50% (tint) and the
// student's predicted range (solid). Where they sit relative to each other
// *is* the fit — the word next to it just names what the picture shows.
export function ScoreFitBar({
  student,
  college,
  fit,
  compact = false,
}: {
  student: { min: number; max: number } | null;
  college: { sat25: number | null; sat75: number | null };
  fit: Fit;
  compact?: boolean;
}) {
  const hasCollege = college.sat25 !== null && college.sat75 !== null;
  return (
    <div className={cn("w-full", compact ? "max-w-56" : "max-w-96")}>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden>
        {hasCollege && (
          <div
            className="absolute inset-y-0 rounded-full bg-marker/60"
            style={{ left: `${pct(college.sat25!)}%`, width: `${Math.max(pct(college.sat75!) - pct(college.sat25!), 2)}%` }}
          />
        )}
        {student && (
          <div
            className="absolute inset-y-0 rounded-full bg-primary"
            style={{ left: `${pct(student.min)}%`, width: `${Math.max(pct(student.max) - pct(student.min), 3)}%` }}
          />
        )}
      </div>
      {!compact && (
        <div className="mt-1.5 flex justify-between text-caption tabular-nums text-muted-foreground" aria-hidden>
          <span>{MIN}</span>
          <span>{MAX}</span>
        </div>
      )}
      <p className="sr-only">
        {FIT_LABEL[fit]}
        {hasCollege && `. Admitted students' middle 50%: ${college.sat25} to ${college.sat75}.`}
        {student && ` Your predicted range: ${student.min} to ${student.max}.`}
      </p>
    </div>
  );
}

export function FitBadge({ fit }: { fit: Fit }) {
  const styles: Record<Fit, string> = {
    likely: "border-green-600/40 bg-green-100 text-green-800 dark:border-green-500/40 dark:bg-green-900/50 dark:text-green-300",
    target: "border-primary/30 bg-accent text-accent-foreground",
    reach: "border-achievement/40 bg-achievement/15 text-achievement-foreground dark:text-achievement",
    unknown: "border-border text-muted-foreground",
  };
  return <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold", styles[fit])}>{FIT_LABEL[fit]}</span>;
}
