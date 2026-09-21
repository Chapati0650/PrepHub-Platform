import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readPendingRushCode } from "@/lib/rush/pending-join";
import { TrendingUp, Check, ChevronRight, Pencil, Flame } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPaidAccess } from "@/lib/entitlements";
import { isFreePracticeSet } from "@/lib/practice/free-tier";
import { getDailyStatus } from "@/lib/daily/challenge";
import { getDashboardData } from "@/lib/dashboard/dashboard-data";
import { getActiveAnnouncementsForStudents, type AnnouncementEntry } from "@/lib/announcements";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { LinkButton } from "@/components/ui/link-button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ScorePrediction } from "@/components/score-prediction";
import { Marker } from "@/components/ui/marker";
import { Greeting } from "./greeting";

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
  const [data, membership, adminAssignment, profile, paidAccess] = await Promise.all([
    getDashboardData(session.user.id),
    !isAdmin
      ? prisma.studentMembership.findUnique({ where: { studentId: session.user.id }, select: { status: true, schoolId: true } })
      : null,
    isAdmin
      ? prisma.administratorAssignment.findFirst({
          where: { userId: session.user.id, removedAt: null, organization: { organizationType: "SCHOOL" } },
        })
      : null,
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { onboardingCompletedAt: true, targetScore: true },
    }),
    // The Premium panel is presentational, but it must agree with the real
    // entitlement — administrators have inherent access and never see it.
    hasPaidAccess(session.user.id),
  ]);
  const onboarding = isStudent ? profile : null;
  // Which set is next decides what the one big button says for a free
  // student: Set 1 is free, Set 2 on is where Premium starts.
  const activeSet = isStudent && !paidAccess ? await prisma.practiceSet.findFirst({ where: { studentId: session.user.id, status: "ACTIVE" }, select: { setNumber: true } }) : null;
  const canPractice = paidAccess || !activeSet || isFreePracticeSet(activeSet.setNumber);
  const daily = isStudent ? await getDailyStatus(session.user.id) : { answeredToday: false, streak: 0 };
  const communitySchoolId = membership?.status === "ACTIVE" ? membership.schoolId : adminAssignment?.organizationId;
  const hasSchoolCommunity = Boolean(communitySchoolId);

  // PRD-011 §16 — school announcements appear inside PrepHub for every
  // registered student (and the administrator, evaluating the same product
  // surface) at the school that published them.
  const announcements = communitySchoolId ? await getActiveAnnouncementsForStudents(communitySchoolId) : [];

  // A brand-new student goes straight to the Diagnostic — the intro screen
  // there says everything the old "welcome back, begin diagnostic" card
  // here said, one screen earlier. Grade/target/commitment come after the
  // results (see (app)/onboarding), so a student who has finished the
  // Diagnostic but not that wizard is sent there first. Scoped to STUDENT:
  // administrators never sign up through the public flow.
  if (isStudent && data.diagnosticStatus === "NOT_STARTED") redirect("/diagnostic");
  if (isStudent && data.diagnosticStatus === "COMPLETED" && !onboarding?.onboardingCompletedAt) {
    redirect("/onboarding");
  }

  // A friend's 1v1 Rush link opened while signed out (see middleware.ts):
  // a returning student who logged in lands here, so take them to the
  // challenge before anything else — ahead of the access-selection gate on
  // purpose, since accepting a challenge is free. (A brand-new account
  // never passes through here first; onboarding's completion action does
  // the same check.)
  const pendingRushCode = await readPendingRushCode();
  if (pendingRushCode) redirect(`/rush/join/${pendingRushCode}`);

  // PRD-002 §5.1's access chooser (/access) is deliberately no longer in the
  // new-student path: school access is hidden at launch, which made the
  // page a $25/month card shown before any value (Owner decision,
  // 2026-09-21). /access still exists for the school flow when it returns.

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
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-4 pb-16 sm:p-8">
      <AnnouncementsBanner announcements={announcements} />

      {/* Greeting row — the reference's "Good late night, <name>" with the
          day's two actions directly under it, and the streak where it keeps
          its top-right badge. Continue Practice is the only cta-sized
          control on the page. */}
      <section>
        <div>
          <h1 className="text-page-title sm:text-page-title-lg">
            <Greeting name={data.firstName} />
          </h1>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {canPractice ? (
              <LinkButton size="cta" href="/practice">
                Continue Practice
              </LinkButton>
            ) : (
              <LinkButton size="cta" href="/pricing">
                Unlock Practice Set {activeSet?.setNumber}
              </LinkButton>
            )}
            <LinkButton size="cta" variant="outline" href="/progress">
              View Progress
              <ChevronRight className="size-4" aria-hidden />
            </LinkButton>
          </div>
          {!canPractice && (
            <p className="mt-4 text-sm text-muted-foreground">
              Your free set is done. Premium opens every set after it — $25/month at launch, cancel anytime.
            </p>
          )}
          {canPractice && data.recommendedPace && (
            <p className="mt-4 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{data.recommendedPace.label}</span>{" "}
              {data.recommendedPace.description}
            </p>
          )}
        </div>
      </section>

      {/* The Daily Challenge — free for everyone, the reason to open the app
          tomorrow. One row, not a panel: it is a door, not a dashboard. */}
      {isStudent && (
        <Link
          href="/daily"
          className="flex items-center justify-between gap-4 rounded-2xl border border-border px-5 py-4 transition-colors hover:border-foreground/30"
        >
          <span className="flex items-center gap-3">
            <Flame className="size-5 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="block font-medium">{daily.answeredToday ? "Today's challenge: done." : "Today's Daily Challenge"}</span>
              <span className="block text-sm text-muted-foreground">
                {daily.answeredToday ? "Come back tomorrow for the next one." : "One hard question, free, every day. No clock."}
              </span>
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-heading text-xl font-semibold tabular-nums">{daily.streak}</span>
            <span className="block text-xs text-muted-foreground">day streak</span>
          </span>
        </Link>
      )}

      {/* This week — one bordered row of four numbers, the reference's
          Analytics strip. Cells divide with rules; the row is the only box. */}
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <SectionTitle>This Week</SectionTitle>
          <Link href="/progress" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            View all progress
          </Link>
        </div>
        <div className="grid grid-cols-2 divide-border overflow-hidden rounded-2xl border border-border [&>*:nth-child(n+3)]:border-t sm:grid-cols-4 sm:divide-x sm:[&>*:nth-child(n+3)]:border-t-0">
          <Stat label="Questions This Week" value={String(data.weeklyQuestionsCompleted)} />
          <Stat label="Study Time This Week" value={formatStudyTime(data.weeklyStudyTimeSeconds)} />
          <Stat label="Total Questions Answered" value={String(data.totalQuestionsAnswered)} />
          <Stat label="Study Streak" value={`${data.studyStreak} day${data.studyStreak === 1 ? "" : "s"}`} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          {/* Strengths & Weaknesses — the reference's numbered skill list.
              Fixed category order (PRD-004), not weakest-first: the ordinal
              is a stable reference for "your Grammar row", and the bar and
              percentage already say which ones need work. */}
          <Panel title="Strengths & Weaknesses" action={{ href: "/progress", label: "Weakest skills" }}>
            <ol className="divide-y divide-border">
              {ALL_CATEGORIES.map((category, i) => {
                const entry = data.mastery.find((m) => m.category === category);
                const value = entry?.currentMastery ?? 0;
                return (
                  <li key={category} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
                    <span className="w-6 shrink-0 font-heading text-sm font-semibold tabular-nums text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate">{CATEGORY_LABELS[category]}</span>
                        <span className="shrink-0 font-semibold tabular-nums">{value}%</span>
                      </span>
                      <span
                        className="block h-2 w-full overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={value}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${CATEGORY_LABELS[category]} mastery`}
                      >
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </Panel>

          <Panel title="Recent Improvements">
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
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          {/* Score panel — Predicted over Target, the reference's score card.
              The prediction keeps its hero scale so it stays the one number
              on the page that reads first. */}
          <Panel title="Your Score">
            <div className="flex flex-col gap-6">
              {data.currentRange ? (
                <ScorePrediction min={data.currentRange.min} max={data.currentRange.max} label="PrepHub Score Prediction" />
              ) : (
                <div>
                  <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    PrepHub Score Prediction
                  </p>
                  <p className="mt-2 font-heading text-hero font-semibold tabular-nums">&mdash;</p>
                </div>
              )}
              {data.approximateImprovementSinceStart !== null && data.approximateImprovementSinceStart > 0 && (
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-achievement/20 px-3 py-1.5 text-sm font-semibold text-achievement-foreground dark:text-achievement">
                  &uarr; {data.approximateImprovementSinceStart} pts since you started
                </span>
              )}
              <div className="flex items-end justify-between gap-4 border-t border-border pt-5">
                <div>
                  <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Target Score</p>
                  <p className="mt-1 font-heading text-display-sm font-semibold tracking-tight tabular-nums">
                    {profile.targetScore ?? <span className="text-muted-foreground">&mdash;</span>}
                  </p>
                </div>
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
                >
                  <Pencil className="size-3.5" aria-hidden />
                  {profile.targetScore ? "Edit" : "Set target"}
                </Link>
              </div>
            </div>
          </Panel>

          {/* Premium panel — the reference's "Reach your score goal faster
              with Pro" card. Only for students who haven't paid, and only
              claims what /pricing's table claims. "Faster" is the honest
              framing: the free tier stops at the Diagnostic, so there is no
              practice loop at all without Premium. */}
          {!paidAccess && (
            <section className="rounded-2xl bg-surface-tint p-6">
              <p className="text-caption font-semibold tracking-[0.12em] text-primary uppercase">PrepHub Premium</p>
              <h2 className="mt-2 font-heading text-xl font-semibold tracking-tight text-balance">
                {profile.targetScore ? `Reach ${profile.targetScore} faster with Premium.` : "Reach your target faster with Premium."}
              </h2>
              <ul className="mt-4 flex flex-col gap-2 text-sm">
                {["Unlimited Personalized Practice Sets", "Prediction updated after every set", "800 Club, 1v1 Rush and College Apps"].map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <LinkButton className="rounded-full px-5" href="/pricing">
                  View plans
                  <ChevronRight className="size-4" aria-hidden />
                </LinkButton>
                <span className="text-sm text-muted-foreground">50% off at launch</span>
              </div>
            </section>
          )}

          {/* School Community Shortcut — PRD-004 §13: only shown when there's a
              school to be a community about; kept small, never a dashboard focus. */}
          {hasSchoolCommunity && (
            <Link href="/community" className="text-sm underline underline-offset-4 hover:text-foreground">
              View School Community &rarr;
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// A bordered module with a title row: the reference's dashboard is built
// from these. The border is the module's only chrome — no tint, no shadow,
// no icon in the corner — so the content inside is what carries weight.
function Panel({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border p-5 sm:p-6">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="font-heading text-base font-semibold">{title}</h2>
        {action && (
          <Link href={action.href} className="shrink-0 text-sm text-muted-foreground underline-offset-4 hover:underline">
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{children}</h2>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-heading text-display-sm font-semibold tracking-tight tabular-nums">{value}</p>
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

