import { prisma } from "@/lib/prisma";
import { CORE_QUESTION_COUNT, coreAttempts, diagnosticStage } from "@/lib/diagnostic/sequence";
import type { OutgoingEmail } from "@/lib/email";
import { drainForRequest } from "@/lib/email-queue";
import { dayKey } from "@/lib/daily/challenge";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { weakestCategories } from "@/lib/session/verdict";
import { decidePaidAccess } from "@/lib/entitlements";
import { studentsActiveSince } from "@/lib/school/student-activity";
import { unsubscribeToken } from "./unsubscribe";

// Lifecycle emails (2026-09-21). Three, deliberately: the ones the funnel
// numbers asked for. 19 students abandoned the Diagnostic in the fortnight
// before this existed and nothing ever reached them; the daily-reminder
// toggle in Settings had no sender behind it. Every send is recorded in
// EmailSend first (unique on user/kind/day), so a re-run of the cron can't
// double-send, and every send is best-effort: a Resend failure is logged
// and never propagates.
//
// The two daily kinds go through the outbound email queue rather than being
// sent here. Sent one at a time they capped out at a few hundred a day: a
// district of thousands would have had most of its students never reminded,
// and the run killed by the host's time limit partway through. Queued, the
// cron run only writes rows, and the queue's scheduled drain sends them a
// hundred to a provider call.
//
// Plain text on purpose — the welcome email is plain text in the Owner's
// voice, and a templated HTML newsletter next to it would read as marketing.

const SITE = process.env.NEXTAUTH_URL ?? "https://prephubtp.com";
const REAL_STUDENT = { role: "STUDENT" as const, email: { not: { contains: "example.com" } }, deletedAt: null };

// Immediately after the Diagnostic: the score, what's weak, and that the
// first set is free. Called from finalizeDiagnosticCompletion, best-effort.
//
// Queued rather than sent, claim and mail in one transaction like the daily
// kinds: sent directly, a provider error after the claim was recorded lost
// the email for good (the claim said it had gone), and the call isn't awaited
// by its caller, so a serverless host could freeze it before it finished.
// The drain right after usually delivers it at once; if not, the scheduled
// drain does within minutes.
export async function sendDiagnosticResultsEmail(studentId: string): Promise<void> {
  const [user, prediction, states] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId }, select: { email: true, firstName: true } }),
    prisma.predictionHistoryEntry.findFirst({ where: { studentId, sourceType: "DIAGNOSTIC" }, orderBy: { createdAt: "desc" } }),
    prisma.categoryState.findMany({ where: { studentId }, select: { category: true, ability: true } }),
  ]);
  if (!user || !prediction) return;
  const weak = weakestCategories(states.map((s) => ({ category: s.category, currentMastery: s.ability }))).map((c) => CATEGORY_LABELS[c]);
  const message: OutgoingEmail = {
    to: user.email,
    subject: `Your predicted SAT score: ${prediction.displayedRangeMinimum}–${prediction.displayedRangeMaximum}`,
    text: `Hi ${user.firstName},

You finished the Diagnostic. Your first PrepHub Score Prediction is ${prediction.displayedRangeMinimum}–${prediction.displayedRangeMaximum}.

The categories costing you the most right now: ${weak.join(" and ")}.

Your first personalized practice set is built around exactly those, and it's free. It's waiting here:
${SITE}/practice

Every set after that updates your prediction, so you can watch it move.

— Prithvi, PrepHub`,
  };
  const queued = await claimAndQueue("results", "once", new Map([[studentId, message]]));
  if (queued > 0) await drainForRequest();
}

/** Students read per database round trip when building a day's mail. */
const PAGE_SIZE = 1_000;

/**
 * Records the claims for one page of mail and queues the messages for exactly
 * the claims this run won, in one transaction. A claim that already existed
 * (a re-run, or two overlapping runs) is skipped by the insert itself, so its
 * student isn't queued a second copy; and there is no state in which a claim
 * was recorded but the mail it stands for was never queued.
 */
async function claimAndQueue(kind: string, day: string, messages: Map<string, OutgoingEmail>): Promise<number> {
  if (messages.size === 0) return 0;
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.emailSend.createManyAndReturn({
      data: [...messages.keys()].map((userId) => ({ userId, kind, day })),
      skipDuplicates: true,
      select: { userId: true },
    });
    const rows = claimed.flatMap(({ userId }) => {
      const message = messages.get(userId);
      return message ? [{ kind, to: message.to, subject: message.subject, body: message.text }] : [];
    });
    if (rows.length > 0) await tx.queuedEmail.createMany({ data: rows });
    return rows.length;
  });
}

type NudgeCandidate = {
  email: string;
  firstName: string;
  diagnosticSession: { attempts: Parameters<typeof coreAttempts>[0] } | null;
};

/**
 * The "finish your Diagnostic" message. Counted against the staged
 * Diagnostic's fourteen core questions, which is what the student sees when
 * they come back: a session they began under the old 21-question order is
 * converted on return (see src/lib/diagnostic/stages.ts), keeping every answer
 * they gave.
 */
export function finishDiagnosticMessage(u: NudgeCandidate): OutgoingEmail {
  const attempts = u.diagnosticSession?.attempts ?? [];
  const coreAnswered = coreAttempts(attempts).filter((a) => a.submittedAt !== null).length;
  const stage = attempts.length > 0 ? diagnosticStage(attempts) : "CORE";
  const remaining = CORE_QUESTION_COUNT - coreAnswered;
  const minutes = Math.max(3, Math.round((remaining / CORE_QUESTION_COUNT) * 15));

  const subject =
    stage === "BONUS"
      ? "Your bonus round is waiting"
      : stage === "DONE"
        ? "Your predicted SAT score is ready"
        : coreAnswered > 0
          ? `You're ${coreAnswered} of ${CORE_QUESTION_COUNT} questions in`
          : `Your predicted SAT score is ${CORE_QUESTION_COUNT} questions away`;
  const lead =
    stage === "BONUS"
      ? `You finished all ${CORE_QUESTION_COUNT} Diagnostic questions and unlocked a bonus round. Answer those and your predicted SAT score is ready.`
      : stage === "DONE"
        ? "You've answered every Diagnostic question. Open it once more to see your predicted SAT score."
        : coreAnswered > 0
          ? `You answered ${coreAnswered} of the ${CORE_QUESTION_COUNT} Diagnostic questions — your progress is saved, and the remaining ${remaining} take about ${minutes} minutes.`
          : `The Diagnostic is ${CORE_QUESTION_COUNT} questions, about 15 minutes, and it ends with your predicted SAT score and the categories costing you the most.`;

  return {
    to: u.email,
    subject,
    text: `Hi ${u.firstName},

${lead}

Pick it back up here:
${SITE}/diagnostic

Your first practice set after it is free.

— Prithvi, PrepHub`,
  };
}

// Day-after nudge for anyone who signed up but hasn't finished the
// Diagnostic. Once per account, ever. Returns how many were queued.
export async function queueFinishDiagnosticNudges(now = new Date()): Promise<number> {
  const lower = new Date(now.getTime() - 7 * 86400e3);
  const upper = new Date(now.getTime() - 20 * 3600e3);
  let queued = 0;
  let after = "";
  while (true) {
    const page = await prisma.user.findMany({
      where: {
        ...REAL_STUDENT,
        id: { gt: after },
        createdAt: { gte: lower, lte: upper },
        OR: [{ diagnosticSession: null }, { diagnosticSession: { status: { not: "COMPLETED" } } }],
        emailSends: { none: { kind: "finish_diagnostic" } },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        diagnosticSession: {
          select: {
            attempts: {
              select: { id: true, category: true, difficulty: true, submittedAt: true, isCorrect: true, waivedAt: true },
            },
          },
        },
      },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
    });
    if (page.length === 0) break;
    queued += await claimAndQueue("finish_diagnostic", "once", new Map(page.map((u) => [u.id, finishDiagnosticMessage(u)])));
    if (page.length < PAGE_SIZE) break;
    after = page[page.length - 1].id;
  }
  return queued;
}

/**
 * The daily reminder. "Paid" is the entitlement service's verdict, not the
 * subscription alone: a student whose district covers them has a practice set
 * waiting too, and used to be pointed at the free Daily Challenge instead.
 */
export function dailyReminderMessage(u: { id: string; email: string; firstName: string }, paid: boolean): OutgoingEmail {
  const token = unsubscribeToken(u.id);
  const optOut = token
    ? `Don't want these? Turn them off in one click:\n${SITE}/unsubscribe/${token}`
    : "You can turn these off any time in Settings, under Notifications.";
  return {
    to: u.email,
    subject: paid ? "Today's practice set is waiting" : "Today's Daily Challenge is waiting",
    text: `Hi ${u.firstName},

${paid ? "Half a set today keeps your prediction moving. Your next questions are ready:" : "One hard question, no clock, and your streak stays alive:"}
${SITE}${paid ? "/practice" : "/daily"}

— Prithvi, PrepHub

${optOut}`,
  };
}

/**
 * Whether today's reminder goes to a student who hasn't studied today.
 *
 * Daily while they're studying (anything in the last week), weekly once
 * they've drifted (last activity 8–30 days ago), and then nothing. It used to
 * be every day for as long as the toggle was on, which in October 2026 meant
 * about seventy emails a day, most of them to students who had stopped months
 * earlier — 162 of the 194 with reminders on hadn't touched PrepHub in two
 * weeks. Mail nobody opens is what gets a sending domain filtered, and this
 * domain also carries password resets and school announcements.
 */
export function reminderDue(student: {
  activeInLastWeek: boolean;
  activeInLastMonth: boolean;
  remindedInLastSixDays: boolean;
}): boolean {
  if (student.activeInLastWeek) return true;
  if (student.activeInLastMonth) return !student.remindedInLastSixDays;
  return false;
}

const DAY_MS = 86_400_000;

// The Settings toggle. Only to students who have it on and haven't answered
// anything today, anywhere in the product, on the cadence reminderDue sets.
// Paid students are pointed at their set; free students at the Daily
// Challenge. Stops paging at `deadline` (a later run the same evening carries
// on where this one stopped: today's claims are already recorded). Returns how
// many were queued and whether every student was reached.
export async function queueDailyReminders(
  now = new Date(),
  deadline = Number.POSITIVE_INFINITY,
): Promise<{ queued: number; complete: boolean }> {
  const day = dayKey(now);
  const startOfDay = new Date(`${day}T00:00:00Z`);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
  const sixDaysAgoKey = dayKey(new Date(now.getTime() - 6 * DAY_MS));
  let queued = 0;
  let after = "";
  while (true) {
    if (Date.now() > deadline) return { queued, complete: false };
    const page = await prisma.user.findMany({
      where: {
        ...REAL_STUDENT,
        id: { gt: after },
        dailyReminderEnabled: true,
        diagnosticSession: { status: "COMPLETED" },
        emailSends: { none: { kind: "daily_reminder", day } },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        role: true,
        subscription: true,
        studentMembership: { include: { organization: true } },
      },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
    });
    if (page.length === 0) break;
    const ids = page.map((u) => u.id);
    // Activity since a month ago, narrowed in memory: one scan of the answer
    // tables per page instead of three.
    const [activeThisMonth, recentReminders] = await Promise.all([
      studentsActiveSince(ids, monthAgo),
      prisma.emailSend.findMany({
        where: { userId: { in: ids }, kind: "daily_reminder", day: { gte: sixDaysAgoKey } },
        select: { userId: true },
      }),
    ]);
    const [activeThisWeek, studiedToday] = await Promise.all([
      studentsActiveSince([...activeThisMonth], weekAgo),
      studentsActiveSince([...activeThisMonth], startOfDay),
    ]);
    const reminded = new Set(recentReminders.map((r) => r.userId));
    const messages = new Map(
      page
        .filter(
          (u) =>
            !studiedToday.has(u.id) &&
            reminderDue({
              activeInLastWeek: activeThisWeek.has(u.id),
              activeInLastMonth: activeThisMonth.has(u.id),
              remindedInLastSixDays: reminded.has(u.id),
            }),
        )
        .map((u) => [u.id, dailyReminderMessage(u, decidePaidAccess(u.role, u.subscription, u.studentMembership))]),
    );
    queued += await claimAndQueue("daily_reminder", day, messages);
    if (page.length < PAGE_SIZE) break;
    after = page[page.length - 1].id;
  }
  return { queued, complete: true };
}

/**
 * Queues the day's nudges and reminders. Sending is the email queue's job:
 * its scheduled drain picks these up within minutes.
 */
export async function runDailyLifecycle(
  now = new Date(),
  deadline = Number.POSITIVE_INFINITY,
): Promise<{ nudges: number; reminders: number; complete: boolean }> {
  const nudges = await queueFinishDiagnosticNudges(now);
  const { queued: reminders, complete } = await queueDailyReminders(now, deadline);
  return { nudges, reminders, complete };
}
