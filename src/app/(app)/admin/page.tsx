import { ClipboardList, BarChart3 } from "lucide-react";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { getAdminOverviewData } from "@/lib/admin/overview";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

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
export default async function AdminOverviewPage() {
  const { schoolId } = await requireAdminSchoolContext();

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

  const data = await getAdminOverviewData(schoolId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 sm:p-8">
      <PageHeader eyebrow="Admin Overview" title={data.schoolName} icon={BarChart3} />

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <p className="font-heading text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
