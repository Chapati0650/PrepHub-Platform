import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Lock, AlertCircle } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { canOpenPracticeSet, isFreePracticeSet } from "@/lib/practice/free-tier";
import { hasPaidAccess } from "@/lib/entitlements";
import { FUNNEL_EVENTS, track } from "@/lib/analytics/track";
import { generatePracticeSet } from "@/lib/adaptive/generate-practice-set";
import { LinkButton } from "@/components/ui/link-button";
import { Marker } from "@/components/ui/marker";

// PRD-005 — the thin gateway between the Dashboard and the active Practice
// Session. Never opens a question directly; always shows set state first.
export default async function PracticePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;

  const diagnostic = await prisma.diagnosticSession.findUnique({ where: { studentId } });

  // Was a bare redirect("/diagnostic"), which bounced anyone clicking
  // Practice in the nav with no reason given and read as a toll gate. The
  // dependency is real rather than arbitrary, so it is explained instead:
  // a Personalized Practice set is generated from the student's per-category
  // ability scores, and those rows only exist once the Diagnostic has been
  // completed. Practice they *can* do right now is offered alongside, so
  // this is a fork rather than a wall.
  if (diagnostic?.status !== "COMPLETED") {
    const started = diagnostic?.status === "IN_PROGRESS";
    const paid = await hasPaidAccess(studentId);
    return (
      <PracticeShell>
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Personalized Practice
        </p>
        <h1 className="mt-3 text-display-sm text-balance">
          Your sets are built from your <Marker>Diagnostic</Marker>.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Every practice set is generated from your own score in each of the seven categories and
          weighted toward whichever ones are costing you the most. Until the Diagnostic has run
          there is nothing to build that from, which is the only reason this is locked.
        </p>
        <p className="mt-3 text-muted-foreground">
          {started
            ? "You have already started it and your answers are saved, so you can pick up where you stopped."
            : "It is 14 questions and takes about 15 minutes. Your answers save as you go, so you can stop and come back."}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <LinkButton size="cta" href="/diagnostic">
            {started ? "Resume Diagnostic" : "Start the Diagnostic"}
          </LinkButton>
          <LinkButton size="cta" variant="outline" href={paid ? "/practice/focused" : "/daily"}>
            {paid ? "Drill a category instead" : "Try today's Daily Challenge"}
          </LinkButton>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">
          {paid
            ? "Focused Practice lets you pick a category and difficulty and work on it right now, without waiting for the Diagnostic."
            : "The Daily Challenge is one hard question a day, free on every account, and it works before the Diagnostic."}
        </p>
      </PracticeShell>
    );
  }

  let set = await prisma.practiceSet.findFirst({
    where: { studentId, status: "ACTIVE" },
    include: { slots: { include: { finalizedAttempt: true } } },
  });

  let generationFailed = false;
  if (!set) {
    try {
      const created = await generatePracticeSet(studentId);
      set = await prisma.practiceSet.findFirst({
        where: { id: created.id },
        include: { slots: { include: { finalizedAttempt: true } } },
      });
    } catch {
      generationFailed = true;
    }
  }

  if (generationFailed || !set) {
    return (
      <PracticeShell>
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          <AlertCircle className="mr-1.5 inline size-3.5 align-[-0.15em]" aria-hidden />
          Something went wrong
        </p>
        <h1 className="mt-3 text-display-sm text-balance">
          We couldn&apos;t prepare your next practice set.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Your progress is safe &mdash; nothing you&apos;ve answered has been lost. Try again in a moment.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <LinkButton size="cta" href="/practice">
            Try Again
          </LinkButton>
          <LinkButton size="cta" variant="outline" href="/home">
            Back to Dashboard
          </LinkButton>
        </div>
      </PracticeShell>
    );
  }

  const questionsCompleted = set.slots.filter((s) => s.finalizedAttempt !== null).length;

  // Set 1 is free (see lib/practice/free-tier.ts); the paywall sits here
  // from Set 2 on, right after the student has watched their prediction
  // move once — the strongest possible case for the next one.
  if (!(await canOpenPracticeSet(studentId, set.setNumber))) {
    void track(FUNNEL_EVENTS.PAYWALL_VIEWED, { userId: studentId, path: "/practice" });
    const [latest, previous] = await prisma.predictionHistoryEntry.findMany({
      where: { studentId },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { displayedRangeMinimum: true, displayedRangeMaximum: true },
    });
    const moved = latest && previous ? (latest.displayedRangeMinimum + latest.displayedRangeMaximum - previous.displayedRangeMinimum - previous.displayedRangeMaximum) / 2 : 0;
    return (
      <PracticeShell>
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          <Lock className="mr-1.5 inline size-3.5 align-[-0.15em]" aria-hidden />
          Practice Set {set.setNumber}
        </p>
        <h1 className="mt-3 text-display-sm text-balance">
          Your next set is <Marker>ready</Marker>.
        </h1>
        <p className="mt-4 max-w-prose text-lg text-muted-foreground">
          {latest && previous
            ? moved > 0
              ? `One set moved your prediction up ${Math.round(moved)} points, to ${latest.displayedRangeMinimum}–${latest.displayedRangeMaximum}. `
              : `Your prediction is now ${latest.displayedRangeMinimum}–${latest.displayedRangeMaximum}. `
            : ""}
          Set {set.setNumber} is built from everything you just answered &mdash; the categories that cost you the most get the
          most questions. Premium opens it, and every set after it.
        </p>
        <div className="mt-8">
          <QuestionProgressPips total={set.slots.length} completed={0} dimmed />
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <LinkButton size="cta" href="/pricing">
            Unlock every set
          </LinkButton>
          <span className="text-sm text-muted-foreground">$25/month at launch &middot; cancel anytime</span>
        </div>
      </PracticeShell>
    );
  }

  return (
    <PracticeShell>
      <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {isFreePracticeSet(set.setNumber) ? "Free · personalized from your Diagnostic." : "Personalized from your performance."}
      </p>
      {/* The set number is the hero, at the same scale the dashboard gives the
          Score Prediction. It is the one number this page exists to state, and
          a student arriving here should see how far they have come before they
          see the button. */}
      <h1 className="mt-3 font-heading text-display font-semibold tracking-tight">
        Practice Set <span className="tabular-nums">{set.setNumber}</span>
      </h1>
      <p className="mt-3 text-lg text-muted-foreground">
        {questionsCompleted > 0
          ? `${questionsCompleted} of ${set.slots.length} questions completed`
          : `${set.slots.length} Questions`}
      </p>
      <div className="mt-8">
        <QuestionProgressPips total={set.slots.length} completed={questionsCompleted} />
      </div>
      <div className="mt-8">
        <LinkButton size="cta" href="/practice/session">
          {questionsCompleted > 0 ? "Continue Practice" : "Start Practice"}
        </LinkButton>
      </div>
    </PracticeShell>
  );
}

// All three states of this page share one shell so they cannot drift into
// three different layouts. Left-aligned rather than centered: a centered
// column with a glyph on top, a heading, a line of grey text and a button was
// the shape all three took, and it is the shape every generated "status
// screen" takes.
// Every state of this page sits inside the shell, so the Focused Practice
// door belongs here rather than in each branch — a student who has finished
// their set, is mid-set, or is looking at a paywall all have the same reason
// to want to drill one category.
function PracticeShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6 sm:p-10">
      <div className="rounded-3xl bg-surface-tint p-8 sm:p-12">{children}</div>
      <Link
        href="/practice/focused"
        className="group flex items-center justify-between gap-4 rounded-2xl border border-border p-5 transition-colors hover:bg-muted/50"
      >
        <span className="min-w-0">
          <span className="block font-heading font-semibold tracking-tight">Focused Practice</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            Pick a category and difficulty and drill 10 questions on exactly that.
          </span>
        </span>
        <span
          className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        >
          &rarr;
        </span>
      </Link>
    </div>
  );
}

// A real, at-a-glance visual for how far into the set you are — replaces a
// bare "X of Y completed" line with something you can actually scan. Bars
// rather than dots: 21 dots read as decoration, 21 short bars read as a
// sequence of questions, and the shape matches the segmented progress used in
// the session runner itself.
function QuestionProgressPips({ total, completed, dimmed = false }: { total: number; completed: number; dimmed?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-6 rounded-full ${
            dimmed ? "bg-foreground/10" : i < completed ? "bg-primary" : "bg-foreground/10"
          }`}
        />
      ))}
    </div>
  );
}
