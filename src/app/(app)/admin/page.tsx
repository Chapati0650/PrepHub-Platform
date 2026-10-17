import { ClipboardList, BarChart3 } from "lucide-react";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { getAdminOverviewData } from "@/lib/admin/overview";
import { getCampusImpact } from "@/lib/admin/impact";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { OwnerSchoolSwitcher } from "./school-switcher";

const ACCESS_STATUS_LABELS: Record<string, string> = {
  SETUP: "Setting Up",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended",
  ARCHIVED: "Archived",
};

function formatMonthYear(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

// PRD-011 §10 — the administrator-only area's landing page: a concise,
// all-time summary of the school's PrepHub activity. Every metric here
// structurally excludes the administrator's own learning activity (§7) —
// `getAdminOverviewData` scopes every query through `StudentMembership`,
// which the administrator account never has.
export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const { school } = await searchParams;
  const { schoolId, viewingAsOwner, availableSchools } = await requireAdminSchoolContext(school);

  if (!schoolId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <div className="inline-flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <ClipboardList className="size-5" aria-hidden />
        </div>
        <h1 className="text-xl sm:text-2xl">Admin Overview isn&apos;t available for this account.</h1>
        <p className="text-muted-foreground">
          This area is scoped to a single school. Contact PrepHub support if you believe this is unexpected.
        </p>
      </div>
    );
  }

  const [data, impact] = await Promise.all([
    getAdminOverviewData(schoolId),
    getCampusImpact(schoolId),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 sm:p-8">
      {viewingAsOwner && (
        <OwnerSchoolSwitcher basePath="/admin" schools={availableSchools} currentSchoolId={schoolId} />
      )}

      <PageHeader eyebrow="Admin Overview" title={data.schoolName} />

      {/* Enrollment & Registration */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">Enrollment</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            label="Total School Enrollment"
            value={data.enrollment.totalSchoolEnrollment !== null ? data.enrollment.totalSchoolEnrollment.toLocaleString() : "—"}
          />
          <Stat label="Registered PrepHub Students" value={data.enrollment.registeredStudents.toLocaleString()} />
          <Stat
            label="Registration Percentage"
            value={data.enrollment.registrationPercentage !== null ? `${data.enrollment.registrationPercentage}%` : "—"}
          />
        </div>
        {data.enrollment.totalSchoolEnrollment === null && (
          <p className="mt-2 text-xs text-muted-foreground">
            Total School Enrollment hasn&apos;t been set yet. Contact PrepHub support to have it configured.
          </p>
        )}
      </div>

      {/* All-Time School Activity */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">All-Time School Activity</h2>
        {data.stats.totalAdaptiveSessionsCompleted === 0 && data.stats.totalQuestionsAnswered === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No activity yet"
            description="Your students have not completed any practice activity yet. School-wide progress will appear after students begin studying."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Questions Answered" value={data.stats.totalQuestionsAnswered.toLocaleString()} />
            <Stat label="Study Hours" value={data.stats.totalStudyHours.toLocaleString()} />
            <Stat label="Adaptive Sessions Completed" value={data.stats.totalAdaptiveSessionsCompleted.toLocaleString()} />
            <Stat label="Est. SAT Points Improved" value={data.stats.totalEstimatedSatPointsImproved.toLocaleString()} />
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Est. SAT Points Improved is an estimate based on PrepHub Score Predictions, not an official College Board result. All
          metrics are all-time totals and reflect student activity only.
        </p>
      </div>

      {/* Results — PRD-011 §10 extended (2026-10-17). Every figure is a count
          or a distribution statistic; `biggestScoreGain` and
          `topStudentStudyHours` are extremes of a distribution, not a named
          student, so this stays aggregate-only (§7). */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">Results</h2>
        {impact.measurableStudents === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No measurable gains yet"
            description="A student needs a Diagnostic and at least one completed Practice Set before their score movement can be measured. These numbers appear once that happens."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat
                label="Avg. Score Gain"
                value={impact.averageScoreGain !== null ? formatGain(impact.averageScoreGain) : "—"}
              />
              <Stat
                label="Biggest Score Gain"
                value={impact.biggestScoreGain !== null ? formatGain(impact.biggestScoreGain) : "—"}
              />
              <Stat
                label="Students Improved"
                value={`${impact.studentsImproved} of ${impact.measurableStudents}`}
              />
              <Stat
                label="Avg. Study Time"
                value={impact.averageStudyHours !== null ? `${impact.averageStudyHours}h` : "—"}
              />
              <Stat
                label="Top Student Study Time"
                value={impact.topStudentStudyHours !== null ? `${impact.topStudentStudyHours}h` : "—"}
              />
              <Stat label="Students Studying" value={impact.activeStudents.toLocaleString()} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Score gains compare each student&apos;s first PrepHub Score Prediction with their
              latest. Study time is derived from completed session length.
            </p>
          </>
        )}
      </div>

      {/* College readiness benchmark */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">College Readiness Benchmark</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Crossed the Benchmark" value={impact.benchmark.crossed.toLocaleString()} />
          <Stat label="Already Met, Held" value={impact.benchmark.held.toLocaleString()} />
          <Stat label="Still Below" value={impact.benchmark.below.toLocaleString()} />
          <Stat label="Fell Back" value={impact.benchmark.slipped.toLocaleString()} />
        </div>
        {impact.benchmark.below > 0 && (
          <div className="mt-3 rounded-lg border border-border p-4 text-sm">
            <p className="font-medium">Of the students still below, how far</p>
            <div className="mt-2 flex flex-col gap-1 text-muted-foreground">
              <Shortfall
                label="Missing Math only"
                count={impact.benchmark.shortfall.MISSES_MATH_ONLY}
              />
              <Shortfall
                label="Missing Reading & Writing only"
                count={impact.benchmark.shortfall.MISSES_READING_ONLY}
              />
              <Shortfall label="Missing both" count={impact.benchmark.shortfall.MISSES_BOTH} />
            </div>
            <p className="mt-2 text-xs">
              A student missing one subject is the closest to a readiness credit.
            </p>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          &ldquo;Crossed&rdquo; counts students who were below at least one Texas Success
          Initiative criterion at their first prediction and now meet both
          ({impact.benchmark.readingWritingBenchmark} Reading &amp; Writing,{" "}
          {impact.benchmark.mathBenchmark} Math). Based on PrepHub Score Predictions, which are
          estimates and not official College Board results or an official CCMR determination.
        </p>
      </div>

      {/* School Access */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">School Access</h2>
        <div className="rounded-lg border border-border p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">School Access Status</span>
            <span className="font-medium">{ACCESS_STATUS_LABELS[data.access.status] ?? data.access.status}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-muted-foreground">Student Access Period</span>
            <span className="font-medium">
              {formatMonthYear(data.access.contractStartDate)} – {formatMonthYear(data.access.contractEndDate)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatGain(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

function Shortfall({ label, count }: { label: string; count: number }) {
  return (
    <span className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <span className="font-medium tabular-nums text-foreground">{count}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <p className="font-heading text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
