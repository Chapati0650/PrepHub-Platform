import Link from "next/link";
import { MIN_GROUP_SIZE, MIN_STUDENTS_FOR_SCORE_FIGURES, type ProtectedCount } from "@/lib/admin/impact";
import type { DistrictOverview, FigureRow } from "@/lib/admin/district-overview";
import { StaffHeader, StaffNote, StaffPage, StaffSection, StatStrip } from "@/components/staff/staff-ui";
import { DistrictCampusSwitcher } from "./school-switcher";

function count(value: ProtectedCount): string {
  return value === null ? `Fewer than ${MIN_GROUP_SIZE}` : value.toLocaleString();
}

function gain(row: FigureRow): string {
  if (row.averageScoreGain === null) return "Not enough yet";
  return row.averageScoreGain > 0 ? `+${row.averageScoreGain}` : String(row.averageScoreGain);
}

/** The district administrator's landing page: district totals, then one row per campus. */
export function DistrictOverviewView({
  overview,
  campuses,
}: {
  overview: DistrictOverview;
  campuses: { id: string; name: string }[];
}) {
  const { totals, excluded } = overview;
  const note = (n: number, rule: string) => (n > 0 ? ` · excludes ${n === 1 ? "1 campus" : `${n} campuses`} with ${rule}` : "");
  return (
    <StaffPage>
      <DistrictCampusSwitcher basePath="/admin" districtName={overview.districtName} campuses={campuses} currentSchoolId={null} allowAll />
      <StaffHeader
        eyebrow="Your district"
        title={overview.districtName}
        description="How PrepHub is going across your district, and at each campus. These are totals: no student's scores are ever shown."
      />

      <StaffSection
        title="District at a glance"
        description={overview.campuses.length === 1 ? "Across 1 campus." : `Across ${overview.campuses.length.toLocaleString()} campuses.`}
      >
        <StatStrip
          columns={3}
          stats={[
            { label: "Students signed up", value: totals.registered.toLocaleString(), hint: "across every campus" },
            { label: "Have started practicing", value: count(totals.started), hint: `answered at least one question${note(excluded.started, `fewer than ${MIN_GROUP_SIZE} students`)}` },
            { label: "Active this week", value: count(totals.activeThisWeek), hint: `practiced in the last 7 days${note(excluded.activeThisWeek, `fewer than ${MIN_GROUP_SIZE} students`)}` },
          ]}
        />
        <StatStrip
          columns={3}
          stats={[
            { label: "Questions answered", value: totals.questionsAnswered.toLocaleString(), hint: "all time, every kind of practice" },
            { label: "Practice Sets finished", value: totals.practiceSetsFinished.toLocaleString(), hint: "all time" },
            {
              label: "Average score gain",
              value: totals.averageScoreGain === null ? "—" : gain(totals),
              hint: `${totals.averageScoreGain === null ? "Not enough students yet" : "points, first prediction to latest"}${note(excluded.scoreGain, `fewer than ${MIN_STUDENTS_FOR_SCORE_FIGURES} measurable students`)}`,
            },
          ]}
        />
        {totals.averageScoreGain === null && (
          <StaffNote>
            Score growth appears once {MIN_STUDENTS_FOR_SCORE_FIGURES} students have a second prediction to compare with
            their first. Any group of fewer than {MIN_GROUP_SIZE} students is shown that way rather than as a number.
          </StaffNote>
        )}
      </StaffSection>

      <StaffSection title="By campus" description="Open a campus to see its own overview, students, teachers, announcements and goal.">
        {overview.campuses.length === 0 ? (
          <StaffNote>No campuses are linked to this district yet. Email PrepHub to add them.</StaffNote>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[56rem] text-left text-base">
              <caption className="sr-only">PrepHub activity by campus</caption>
              <thead className="bg-surface-tint text-sm">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Campus</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Signed up</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Started practicing</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Active this week</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Questions answered</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Practice Sets</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Average gain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {overview.campuses.map((c) => (
                  <tr key={c.campusId}>
                    <th scope="row" className="px-4 py-3 font-medium">
                      <Link href={`/admin?school=${c.campusId}`} className="underline underline-offset-4">
                        {c.campusName}
                      </Link>
                    </th>
                    <td className="px-4 py-3 text-right tabular-nums">{c.registered.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{count(c.started)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{count(c.activeThisWeek)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.questionsAnswered.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.practiceSetsFinished.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{gain(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </StaffSection>
    </StaffPage>
  );
}
