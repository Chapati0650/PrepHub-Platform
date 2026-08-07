import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { needsAccessSelection } from "@/lib/access";
import { getDashboardData } from "@/lib/dashboard/dashboard-data";
import { getActiveAnnouncementsForStudents, type AnnouncementEntry } from "@/lib/announcements";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { Button } from "@/components/ui/button";

function formatStudyTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// PRD-004 — Student Home Dashboard. "Practice happens elsewhere" (§2.4): this
// page only surfaces progress and routes into Practice/Diagnostic, it never
// renders a question itself.
export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // PRD-011 §6/§7 — a School Administrator gets the full student Dashboard,
  // exactly like a student, plus an additional admin-only nav area (added in
  // the app layout). The Owner (who never touches the student product) gets
  // this landing page instead — its own entry points into Schools/Content
  // management, since the Owner has no student-nav header to fall back on.
  if (session.user.role === "OWNER") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
        <h1 className="text-2xl font-semibold">Welcome, {session.user.name}.</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Link
            href="/owner/schools"
            className="rounded-xl border border-border p-5 transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <p className="font-heading text-lg font-semibold">Schools</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage partner schools and districts, administrators, and student memberships.
            </p>
          </Link>
          <Link
            href="/owner/content/questions"
            className="rounded-xl border border-border p-5 transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <p className="font-heading text-lg font-semibold">Content</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Author and publish SAT questions, group them into question families, and review coverage.
            </p>
          </Link>
        </div>
        <Button variant="outline" className="w-fit" render={<Link href="/settings">Account settings</Link>} />
      </div>
    );
  }

  const isAdmin = session.user.role === "SCHOOL_ADMINISTRATOR";
  const [data, membership, adminAssignment] = await Promise.all([
    getDashboardData(session.user.id),
    !isAdmin
      ? prisma.studentMembership.findUnique({ where: { studentId: session.user.id }, select: { status: true, schoolId: true } })
      : null,
    isAdmin
      ? prisma.administratorAssignment.findFirst({
          where: { userId: session.user.id, removedAt: null, organization: { organizationType: "SCHOOL" } },
        })
      : null,
  ]);
  const communitySchoolId = membership?.status === "ACTIVE" ? membership.schoolId : adminAssignment?.organizationId;
  const hasSchoolCommunity = Boolean(communitySchoolId);

  // PRD-011 §16 — school announcements appear inside PrepHub for every
  // registered student (and the administrator, evaluating the same product
  // surface) at the school that published them.
  const announcements = communitySchoolId ? await getActiveAnnouncementsForStudents(communitySchoolId) : [];

  // PRD-002 §5.1: a student who has never chosen an access method lands on
  // the chooser instead of here — but only before they've engaged with the
  // diagnostic at all. PRD-012 §5/§26: the diagnostic (and its results) must
  // stay reachable without choosing school-vs-individual access first, so
  // this must not re-trigger once the diagnostic has been started or completed.
  // Administrators never have a subscription or membership of their own and
  // must never be sent to student access-selection at all (PRD-011 §7 — they
  // use the student product for evaluation, not as a paying/enrolled student).
  if (!isAdmin && data.diagnosticStatus === "NOT_STARTED" && (await needsAccessSelection(session.user.id))) {
    redirect("/access");
  }

  if (data.diagnosticStatus !== "COMPLETED") {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-2xl font-semibold">Welcome back, {data.firstName}.</h1>
        <AnnouncementsBanner announcements={announcements} />
        <p className="text-muted-foreground">
          Complete your diagnostic to generate your first PrepHub Score Prediction and personalized practice plan.
        </p>
        <Button
          size="lg"
          render={<Link href="/diagnostic">{data.diagnosticStatus === "IN_PROGRESS" ? "Resume Diagnostic" : "Begin Diagnostic"}</Link>}
        />
        {hasSchoolCommunity && (
          <Link href="/community" className="text-sm underline underline-offset-2 hover:text-foreground">
            View School Community →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Welcome back, {data.firstName}.</h1>

      <AnnouncementsBanner announcements={announcements} />

      {/* PrepHub Score Prediction — informational only, per PRD-004 §7 "Interaction" */}
      <div className="flex flex-col gap-4 rounded-lg border border-border p-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">PrepHub Score Prediction</p>
          <p className="mt-1 font-heading text-6xl font-semibold tabular-nums sm:text-7xl">
            {data.currentRange ? `${data.currentRange.min}–${data.currentRange.max}` : "—"}
          </p>
        </div>
        {data.approximateImprovementSinceStart !== null && data.approximateImprovementSinceStart > 0 && (
          <span className="inline-flex w-fit items-center gap-1 rounded-md bg-achievement/12 px-2 py-1 text-sm font-medium text-achievement-foreground dark:text-achievement">
            ↑ {data.approximateImprovementSinceStart} pts since you started
          </span>
        )}
      </div>

      <Button size="lg" render={<Link href="/practice">Continue Practice</Link>} />

      {/* Weekly Statistics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Questions This Week" value={String(data.weeklyQuestionsCompleted)} />
        <StatCard label="Study Time This Week" value={formatStudyTime(data.weeklyStudyTimeSeconds)} />
        <StatCard label="Total Questions Answered" value={String(data.totalQuestionsAnswered)} />
      </div>

      {/* Study Streak */}
      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Study Streak</p>
        <p
          className={`font-heading text-2xl font-semibold tabular-nums ${
            data.studyStreak > 0 ? "text-achievement-foreground dark:text-achievement" : ""
          }`}
        >
          {data.studyStreak}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            day{data.studyStreak === 1 ? "" : "s"}
          </span>
        </p>
      </div>

      {/* Recent Improvements */}
      {data.recentImprovements.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Recent Improvements</h2>
          <ul className="flex flex-col gap-1.5">
            {data.recentImprovements.map((improvement) => (
              <li key={improvement} className="rounded-md bg-muted p-2 text-sm">
                {improvement}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Strengths & Weaknesses */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Strengths & Weaknesses</h2>
        {ALL_CATEGORIES.map((category) => {
          const entry = data.mastery.find((m) => m.category === category);
          const value = entry?.currentMastery ?? 0;
          return (
            <div key={category}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span>{CATEGORY_LABELS[category]}</span>
                <span className="text-xs text-muted-foreground">{value}%</span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={value}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${CATEGORY_LABELS[category]} mastery`}
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* School Community Shortcut — PRD-004 §13: only shown when there's a
          school to be a community about; kept small, never a dashboard focus. */}
      {hasSchoolCommunity && (
        <Link href="/community" className="text-sm underline underline-offset-2 hover:text-foreground">
          View School Community →
        </Link>
      )}
    </div>
  );
}

// PRD-011 §16 — brief, one-way school communication; deliberately just a
// title + message per item, matching the feature's non-goals (no replies,
// reactions, or attachments).
function AnnouncementsBanner({ announcements }: { announcements: AnnouncementEntry[] }) {
  if (announcements.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2">
      {announcements.map((a) => (
        <div key={a.id} className="rounded-lg border border-border bg-muted/50 p-3 text-left text-sm">
          <p className="font-medium">{a.title}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{a.message}</p>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
