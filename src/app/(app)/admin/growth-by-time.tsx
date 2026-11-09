import { bandLabel, type GrowthByStudyTime } from "@/lib/admin/growth-by-time";
import { MIN_STUDENTS_FOR_SCORE_FIGURES } from "@/lib/admin/impact";
import { StaffNote, StaffSection } from "@/components/staff/staff-ui";

function signed(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

/**
 * "Score growth by hours of practice" on the campus and district Overviews
 * (2026-11-09). One row per band: how many students, their average change in
 * predicted score, as a bar. Every measurable student is in exactly one band
 * and every band holds at least MIN_STUDENTS_FOR_SCORE_FIGURES students
 * (`mergeBands`), so nothing here is withheld and nothing can be subtracted out.
 */
export function GrowthByTimeSection({
  growth,
  scope,
  excludedNote,
}: {
  growth: GrowthByStudyTime | null;
  /** "your school" or "your district". */
  scope: string;
  /** Appended to the description when a district figure leaves campuses out. */
  excludedNote?: string;
}) {
  const top = growth ? Math.max(1, ...growth.bands.map((b) => b.averageGain)) : 1;
  return (
    <StaffSection
      title="Score growth by hours of practice"
      description={
        <>
          The average change in each student&apos;s predicted SAT score, first prediction to latest, grouped by how many
          hours they have practiced on PrepHub.{excludedNote ? ` ${excludedNote}` : ""}
        </>
      }
    >
      {!growth ? (
        <StaffNote>
          Appears once at least {2 * MIN_STUDENTS_FOR_SCORE_FIGURES} students at {scope} can be compared, so that every
          group shown holds at least {MIN_STUDENTS_FOR_SCORE_FIGURES} students and no one student&apos;s score can be
          picked out.
        </StaffNote>
      ) : (
        <>
          <figure className="break-inside-avoid rounded-2xl border border-border p-5">
            <figcaption className="sr-only">Average predicted score change by hours practiced</figcaption>
            <ul className="flex flex-col gap-4">
              {growth.bands.map((b) => {
                const width = b.averageGain > 0 ? Math.max(4, Math.round((100 * b.averageGain) / top)) : 0;
                return (
                  <li key={b.fromHours} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[11rem_1fr_6rem] sm:gap-4">
                    <div>
                      <p className="text-base font-medium">{bandLabel(b)}</p>
                      <p className="text-sm text-muted-foreground">
                        {b.students.toLocaleString()} {b.students === 1 ? "student" : "students"}
                      </p>
                    </div>
                    <div className="h-8 overflow-hidden rounded-lg bg-surface-tint" aria-hidden>
                      <div className="h-full rounded-lg bg-primary" style={{ width: `${width}%` }} />
                    </div>
                    <p className="font-heading text-2xl font-semibold tabular-nums sm:text-right">
                      {signed(b.averageGain)}
                      <span className="ml-1 text-sm font-normal text-muted-foreground">pts</span>
                    </p>
                  </li>
                );
              })}
            </ul>
          </figure>
          <StaffNote>
            Covers all {growth.measured.toLocaleString()} students with a first and a latest prediction. Hours count every
            finished session of any kind. Predictions are PrepHub estimates, not official College Board results, and
            students who practice more may differ in other ways, so this shows an association, not a guarantee.
          </StaffNote>
        </>
      )}
    </StaffSection>
  );
}
