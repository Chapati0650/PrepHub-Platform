import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TrendingUp, Compass } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { needsAccessSelection } from "@/lib/access";
import { getDashboardData } from "@/lib/dashboard/dashboard-data";
import { getActiveAnnouncementsForStudents, type AnnouncementEntry } from "@/lib/announcements";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { LinkButton } from "@/components/ui/link-button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ScorePrediction } from "@/components/score-prediction";
import { Marker } from "@/components/ui/marker";

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
  if (!session?.user?.id) redirect("/login");

  // PRD-011 §6/§7 — a School Administrator gets the full student Dashboard,
  // exactly like a student, plus an additional admin-only nav area (added in
  // the app layout). The Owner (who never touches the student product) gets
  // this landing page instead — its own entry points into Schools/Content
  // management, since the Owner has no student-nav header to fall back on.
  if (session.user.role === "OWNER") {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-8 p-6 sm:p-10">
        <PageHeader title={`Welcome, ${session.user.name}.`} description="Where do you want to work today?" />
        {/* Two destinations, so they are numbered and given real width rather
            than dressed up. The previous version put a solid-teal glyph tile on
            each and lifted them on hover — decoration standing in for
            hierarchy, and the same tile/lift pattern that appeared on every
            other surface in the app. A large ordinal and a full-width rule do
            the same job without adding a third color to the page. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <OwnerEntry
            href="/owner/schools"
            ordinal="01"
            title="Schools"
            description="Partner schools and districts, administrators, and student memberships."
          />
          <OwnerEntry
            href="/owner/content/questions"
            ordinal="02"
            title="Content"
            description="Author and publish SAT questions, group them into families, and review coverage."
          />
        </div>
        <LinkButton variant="outline" className="w-fit rounded-full" href="/settings">
          Account settings
        </LinkButton>
      </div>
    );
  }

  const isAdmin = session.user.role === "SCHOOL_ADMINISTRATOR";
  const isStudent = session.user.role === "STUDENT";
  const [data, membership, adminAssignment, onboarding] = await Promise.all([
    getDashboardData(session.user.id),
    !isAdmin
      ? prisma.studentMembership.findUnique({ where: { studentId: session.user.id }, select: { status: true, schoolId: true } })
      : null,
    isAdmin
      ? prisma.administratorAssignment.findFirst({
          where: { userId: session.user.id, removedAt: null, organization: { organizationType: "SCHOOL" } },
        })
      : null,
    isStudent
      ? prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { onboardingCompletedAt: true } })
      : null,
  ]);
  const communitySchoolId = membership?.status === "ACTIVE" ? membership.schoolId : adminAssignment?.organizationId;
  const hasSchoolCommunity = Boolean(communitySchoolId);

  // PRD-011 §16 — school announcements appear inside PrepHub for every
  // registered student (and the administrator, evaluating the same product
  // surface) at the school that published them.
  const announcements = communitySchoolId ? await getActiveAnnouncementsForStudents(communitySchoolId) : [];

  // Brand-new students see a short personalization wizard before anything
  // else — same "only while NOT_STARTED" escape hatch as the access-selection
  // gate just below, so a student who's engaged with the diagnostic is never
  // bounced backward. Scoped to STUDENT only: administrators never sign up
  // through the public flow this wizard sits in front of.
  if (isStudent && data.diagnosticStatus === "NOT_STARTED" && !onboarding?.onboardingCompletedAt) {
    redirect("/onboarding");
  }

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
      <div className="mx-auto flex max-w-2xl flex-col gap-8 p-6 sm:p-10">
        <AnnouncementsBanner announcements={announcements} />
        {/* Left-aligned, not centered: there is exactly one thing to do here,
            and a centered column of text with a button under it is the shape
            every generated "get started" screen takes. */}
        <div>
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Step one
          </p>
          <h1 className="mt-2 text-display-sm text-balance">
            Welcome back, {data.firstName}. Let&apos;s find your <Marker>starting point</Marker>.
          </h1>
          <p className="mt-4 max-w-prose text-lg text-muted-foreground">
            21 questions across every SAT category. It generates your first Predicted SAT Score range and the
            practice plan everything after this is built from.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <LinkButton size="cta" href="/diagnostic">
            {data.diagnosticStatus === "IN_PROGRESS" ? "Resume Diagnostic" : "Begin Diagnostic"}
          </LinkButton>
          {hasSchoolCommunity && (
            <Link href="/community" className="text-sm underline underline-offset-4 hover:text-foreground">
              View School Community →
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <AnnouncementsBanner announcements={announcements} />

      {/* The one hero block on the page. Previously the greeting, the score,
          the CTA and five more sections were siblings in a flat `gap-8`
          column, all at the same weight - the "everything is equally
          important" rhythm that makes a dashboard read as generated. Grouping
          the score and the single action a student came here to take onto one
          tinted block, and letting everything below it drop to quiet type, is
          the whole hierarchy fix. */}
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <h1 className="text-page-title sm:text-page-title-lg">Welcome back, {data.firstName}.</h1>

        <div className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          {/* PrepHub Score Prediction - informational only, per PRD-004 §7 "Interaction" */}
          {data.currentRange ? (
            <ScorePrediction min={data.currentRange.min} max={data.currentRange.max} label="PrepHub Score Prediction" />
          ) : (
            <div>
              <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                PrepHub Score Prediction
              </p>
              <p className="mt-2 font-heading text-hero font-semibold tabular-nums sm:text-hero-lg">&mdash;</p>
            </div>
          )}
          {data.approximateImprovementSinceStart !== null && data.approximateImprovementSinceStart > 0 && (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-achievement/20 px-4 py-2 text-sm font-semibold text-achievement-foreground dark:text-achievement">
              &uarr; {data.approximateImprovementSinceStart} pts since you started
            </span>
          )}
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <LinkButton size="cta" href="/practice">
            Continue Practice
          </LinkButton>
          {data.recommendedPace && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{data.recommendedPace.label}</span>{" "}
              {data.recommendedPace.description}
            </p>
          )}
        </div>
      </section>

      {/* Weekly Statistics. Three numbers in a row need separating, not
          boxing - a rule between them says "these are three of the same
          thing" where three bordered cards say "these are three features." */}
      <section className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Stat label="Questions This Week" value={String(data.weeklyQuestionsCompleted)} />
        <Stat label="Study Time This Week" value={formatStudyTime(data.weeklyStudyTimeSeconds)} />
        <Stat label="Total Questions Answered" value={String(data.totalQuestionsAnswered)} />
      </section>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.15fr_0.85fr]">
        {/* Strengths & Weaknesses */}
        <section className="flex flex-col gap-4">
          <SectionTitle>Strengths &amp; Weaknesses</SectionTitle>
          <div className="flex flex-col gap-3.5">
            {ALL_CATEGORIES.map((category) => {
              const entry = data.mastery.find((m) => m.category === category);
              const value = entry?.currentMastery ?? 0;
              return (
                <div key={category}>
                  <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
                    <span>{CATEGORY_LABELS[category]}</span>
                    <span className="font-semibold tabular-nums">{value}%</span>
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
        </section>

        <div className="flex flex-col gap-10">
          {/* Study Streak - the achievement accent stays reserved for a streak
              that actually exists; a zero-day streak is plain type, not a
              celebratory surface with nothing to celebrate. */}
          <section className="flex flex-col gap-4">
            <SectionTitle>Study Streak</SectionTitle>
            <p
              className={`font-heading text-display-sm font-semibold tabular-nums ${
                data.studyStreak > 0 ? "text-achievement-foreground dark:text-achievement" : "text-muted-foreground"
              }`}
            >
              {data.studyStreak}
              <span className="ml-2 text-base font-normal text-muted-foreground">
                day{data.studyStreak === 1 ? "" : "s"}
              </span>
            </p>
          </section>

          {/* Recent Improvements */}
          <section className="flex flex-col gap-4">
            <SectionTitle>Recent Improvements</SectionTitle>
            {data.recentImprovements.length > 0 ? (
              <ul className="flex flex-col gap-2.5 border-l-2 border-marker pl-4">
                {data.recentImprovements.map((improvement) => (
                  <li key={improvement} className="text-sm">
                    {improvement}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={TrendingUp}
                title="No improvements yet"
                description="Complete a few more Practice Sets and any real gains will show up here."
              />
            )}
          </section>

          {/* Only shown for accounts that predate the onboarding wizard - with
              a pace set, it rides along with the CTA above instead. */}
          {!data.recommendedPace && (
            <EmptyState
              icon={Compass}
              title="No recommended pace yet"
              description="New accounts get a personalized pace from a quick onboarding quiz - this account signed up before that existed."
            />
          )}

          {/* School Community Shortcut - PRD-004 §13: only shown when there's a
              school to be a community about; kept small, never a dashboard focus. */}
          {hasSchoolCommunity && (
            <Link href="/community" className="text-sm underline underline-offset-4 hover:text-foreground">
              View School Community →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{children}</h2>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-4 sm:px-6 sm:py-0 sm:first:pl-0 sm:last:pr-0">
      <p className="font-heading text-display-sm font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

// An Owner entry point. The ordinal is the whole visual device - it gives the
// two cards a reading order and some weight without a glyph, a tint, or a
// hover lift, matching the numbered steps on the public landing page.
function OwnerEntry({
  href,
  ordinal,
  title,
  description,
}: {
  href: string;
  ordinal: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-2xl bg-surface-tint p-6 transition-colors hover:bg-accent"
    >
      <span className="font-heading text-sm font-semibold tabular-nums text-muted-foreground">{ordinal}</span>
      <p className="font-heading text-lg font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
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

