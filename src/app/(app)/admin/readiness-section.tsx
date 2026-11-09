import type { ReactNode } from "react";
import { MIN_GROUP_SIZE, MIN_STUDENTS_FOR_SCORE_FIGURES, type CampusImpactReport, type CellCount } from "@/lib/admin/impact";
import { StaffNote, StaffSection } from "@/components/staff/staff-ui";

const READINESS_GROUPS = [
  { key: "crossed", label: "Crossed the benchmark", detail: "were below it at first, meet it now", swatch: "bg-achievement" },
  { key: "held", label: "Already met it", detail: "met it at first and still do", swatch: "bg-primary" },
  { key: "below", label: "Still below", detail: "haven't reached it yet", swatch: "bg-foreground/15" },
  { key: "slipped", label: "Fell back", detail: "met it at first, below it now", swatch: "bg-destructive/70" },
] as const;

function groupSize(count: CellCount): string {
  if (count === null) return `Fewer than ${MIN_GROUP_SIZE}`;
  if (count === "withheld") return "Withheld";
  return count.toLocaleString();
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * The Texas Success Initiative benchmark as one bar and its legend, so the
 * shape — how many crossed, how many are still to go — reads at a glance,
 * with the counts in words beside it rather than in four separate boxes.
 * Shared by the campus Overview and (since 2026-11-09) the district Overview.
 *
 * Any group under five is withheld ("Fewer than 5"), and then so is the bar:
 * a segment's width is its count.
 */
export function ReadinessSection({
  benchmark,
  note,
  measured,
}: {
  benchmark: CampusImpactReport["benchmark"];
  note?: ReactNode;
  /** When given and there's no breakdown yet, say why instead of leaving the section out. */
  measured?: number;
}) {
  if (!benchmark) {
    if (!measured) return null;
    return (
      <StaffSection title="College readiness">
        <StaffNote>
          How many students meet the Texas Success Initiative benchmark appears once {MIN_STUDENTS_FOR_SCORE_FIGURES} students
          can be compared. So far, {measured.toLocaleString()} {measured === 1 ? "has" : "have"}.
        </StaffNote>
      </StaffSection>
    );
  }
  const groups = READINESS_GROUPS.map((g) => ({ ...g, count: benchmark[g.key] }));
  const anyWithheld = groups.some((g) => typeof g.count !== "number");

  return (
    <StaffSection
      title="College readiness"
      description={
        <>
          How many students&apos; predicted scores meet the Texas Success Initiative benchmark: {benchmark.readingWritingBenchmark}{" "}
          in Reading &amp; Writing and {benchmark.mathBenchmark} in Math.{note ? <> {note}</> : null}
        </>
      }
    >
      <div className="flex break-inside-avoid flex-col gap-5 rounded-2xl border border-border p-5">
        {!anyWithheld && (
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-foreground/5" aria-hidden>
            {groups.map((g) =>
              typeof g.count === "number" && g.count > 0 ? (
                <span key={g.key} className={g.swatch} style={{ width: `${(g.count / benchmark.measured) * 100}%` }} />
              ) : null,
            )}
          </div>
        )}
        <ul className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <li key={g.key} className="flex items-start gap-3">
              <span className={`mt-1.5 size-3 shrink-0 rounded-full ${g.swatch}`} aria-hidden />
              <span>
                <span className="block text-base font-medium">
                  {g.label}: <span className="tabular-nums">{groupSize(g.count)}</span>
                </span>
                <span className="block text-sm text-muted-foreground">{g.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        {benchmark.below !== 0 && (
          <div className="border-t border-border pt-4">
            <p className="text-base font-medium">
              Of the{" "}
              {benchmark.below === null
                ? `fewer than ${MIN_GROUP_SIZE} students`
                : benchmark.below === "withheld"
                  ? "students"
                  : plural(benchmark.below, "student")}{" "}
              still
              below, they need:
            </p>
            <ul className="mt-2 divide-y divide-border text-base">
              <ShortfallRow label="Math only" count={benchmark.shortfall.MISSES_MATH_ONLY} />
              <ShortfallRow label="Reading & Writing only" count={benchmark.shortfall.MISSES_READING_ONLY} />
              <ShortfallRow label="Both" count={benchmark.shortfall.MISSES_BOTH} />
            </ul>
            <p className="mt-2 text-sm text-muted-foreground">
              Students who need only one subject are the closest to a readiness credit.
            </p>
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Based on PrepHub Score Predictions, which are estimates, not official College Board results or an official CCMR
        determination. A group of 1 to {MIN_GROUP_SIZE - 1} students shows as &ldquo;Fewer than {MIN_GROUP_SIZE}&rdquo;, and where the
        others would give it away, one more group shows as &ldquo;Withheld&rdquo;.
      </p>
    </StaffSection>
  );
}

function ShortfallRow({ label, count }: { label: string; count: CellCount }) {
  return (
    <li className="flex items-center justify-between gap-4 py-2">
      <span>{label}</span>
      <span className="font-medium tabular-nums">
        {count === null ? `Fewer than ${MIN_GROUP_SIZE}` : count === "withheld" ? "Withheld" : plural(count, "student")}
      </span>
    </li>
  );
}
