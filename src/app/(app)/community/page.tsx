import { redirect } from "next/navigation";
import { Users2, Megaphone } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { getSchoolCommunityData } from "@/lib/community/school-community-data";
import { PageHeader } from "@/components/page-header";

function formatMetricValue(metric: string, value: number): string {
  if (metric === "STUDY_HOURS") return `${value.toLocaleString()} hours`;
  return value.toLocaleString();
}

// PRD-009 — collaborative, aggregate-only view of a student's school. Only
// reachable by students with an active school membership; individual/unpaid
// students have no school to show a community for.
export default async function SchoolCommunityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");

  // PRD-011 §6/§7: an Administrator gets the School Community page too, but
  // has an `AdministratorAssignment` to their school, not a `StudentMembership`.
  // District-scoped admins have no single school to show a community for —
  // `requireAdminSchoolContext` is the same resolution the admin-only pages use.
  const isAdmin = session.user.role === "SCHOOL_ADMINISTRATOR";
  const [membership, adminContext] = await Promise.all([
    !isAdmin
      ? prisma.studentMembership.findUnique({
          where: { studentId: session.user.id },
          select: { schoolId: true, status: true },
        })
      : null,
    isAdmin ? requireAdminSchoolContext() : null,
  ]);

  const schoolId = membership?.status === "ACTIVE" ? membership.schoolId : adminContext?.schoolId;

  if (!schoolId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <div className="inline-flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Users2 className="size-5" aria-hidden />
        </div>
        <h1 className="text-xl sm:text-2xl">School Community is available for school-sponsored students.</h1>
        <p className="text-muted-foreground">
          This page shows your school&apos;s collective progress. It becomes available once you&apos;re verified with a partner
          school.
        </p>
      </div>
    );
  }

  const data = await getSchoolCommunityData(schoolId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 sm:p-8">
      {/* School Identity */}
      <PageHeader eyebrow="School Community" title={data.schoolName} icon={Users2} />

      {/* School Progress */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Questions Answered" value={data.stats.totalQuestionsAnswered.toLocaleString()} />
        <Stat label="Study Hours" value={data.stats.totalStudyHours.toLocaleString()} />
        <Stat label="Adaptive Sessions" value={data.stats.totalAdaptiveSessionsCompleted.toLocaleString()} />
        <Stat label="Est. SAT Points Improved" value={data.stats.totalEstimatedSatPointsImproved.toLocaleString()} />
        <Stat label="Active Students This Week" value={data.stats.activeStudentsThisWeek.toLocaleString()} />
        <Stat label="Study Streak" value={`${data.stats.studyStreak} day${data.stats.studyStreak === 1 ? "" : "s"}`} />
      </div>

      {/* School Goal */}
      {data.goal && (
        <div className="rounded-lg border border-border p-4">
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            School Goal: {formatMetricValue(data.goal.metric, data.goal.target)} {data.goal.label}
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.round((data.goal.current / data.goal.target) * 100))}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatMetricValue(data.goal.metric, data.goal.current)} of {formatMetricValue(data.goal.metric, data.goal.target)} —{" "}
            {Math.max(0, data.goal.target - data.goal.current).toLocaleString()} to go.
          </p>
        </div>
      )}

      {/* Community Updates */}
      {data.updates.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Community Updates</h2>
          <ul className="flex flex-col gap-2">
            {data.updates.map((update) => (
              <li key={update} className="flex items-start gap-2.5 rounded-md bg-muted p-2.5 text-sm">
                <Megaphone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                {update}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* School Milestones */}
      {data.milestones.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">School Milestones</h2>
          <div className="flex flex-wrap gap-2">
            {data.milestones.map((m) => (
              <span key={m} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        These statistics reflect your whole school community. Individual students, scores, and rankings are never shown here.
      </p>
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
