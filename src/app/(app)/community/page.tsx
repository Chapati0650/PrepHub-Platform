import Link from "next/link";
import { redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { getSchoolCommunityData } from "@/lib/community/school-community-data";
import { PageHeader } from "@/components/page-header";
import { GoalCard } from "@/components/community/goal-card";

export const metadata = { title: "School Community" };

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
      // Left-aligned on a tint, like every status screen here (CLAUDE.md),
      // with the one way forward: connecting a school email.
      <div className="mx-auto max-w-2xl p-4 sm:p-8">
        <div className="rounded-3xl bg-surface-tint p-6 sm:p-10">
          <h1 className="text-display-sm font-semibold tracking-tight">
            School Community is available for school-sponsored students.
          </h1>
          <p className="mt-3 max-w-prose text-muted-foreground">
            This page shows your school&apos;s collective progress. It becomes available once you&apos;re verified with a
            partner school.
          </p>
          <Link
            href="/access/verify-school"
            className="mt-6 inline-block text-sm font-medium underline underline-offset-4"
          >
            Does your school provide PrepHub? Connect your school email
          </Link>
        </div>
      </div>
    );
  }

  const data = await getSchoolCommunityData(schoolId);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 sm:p-8">
      {/* School Identity */}
      <PageHeader eyebrow="School Community" title={data.schoolName} />

      {/* The goal leads when there is one: it's the one thing on this page a
          student can change, and the prize is the reason to. */}
      {data.goal && <GoalCard goal={data.goal} />}

      {/* School Progress — rules inside one box, not six boxes. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
        <Stat label="Questions Answered" value={data.stats.totalQuestionsAnswered.toLocaleString()} />
        <Stat label="Study Hours" value={data.stats.totalStudyHours.toLocaleString()} />
        <Stat label="Practice Sets" value={data.stats.totalAdaptiveSessionsCompleted.toLocaleString()} />
        <Stat label="Est. SAT Points Improved" value={data.stats.totalEstimatedSatPointsImproved.toLocaleString()} />
        <Stat label="Active Students This Week" value={data.stats.activeStudentsThisWeek.toLocaleString()} />
        <Stat label="Study Streak" value={`${data.stats.studyStreak} day${data.stats.studyStreak === 1 ? "" : "s"}`} />
      </div>

      {/* Community Updates */}
      {data.updates.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Community Updates</h2>
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {data.updates.map((update) => (
              <li key={update} className="flex items-start gap-2.5 py-3 text-sm">
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
    <div className="bg-background p-4">
      <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
