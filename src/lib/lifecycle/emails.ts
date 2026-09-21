import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { dayKey } from "@/lib/daily/challenge";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { weakestCategories } from "@/lib/session/verdict";

// Lifecycle emails (2026-09-21). Three, deliberately: the ones the funnel
// numbers asked for. 19 students abandoned the Diagnostic in the fortnight
// before this existed and nothing ever reached them; the daily-reminder
// toggle in Settings had no sender behind it. Every send is recorded in
// EmailSend first (unique on user/kind/day), so a re-run of the cron can't
// double-send, and every send is best-effort: a Resend failure is logged
// by sendEmail and never propagates.
//
// Plain text on purpose — the welcome email is plain text in the Owner's
// voice, and a templated HTML newsletter next to it would read as marketing.

const SITE = process.env.NEXTAUTH_URL ?? "https://prephubtp.com";
const REAL_STUDENT = { role: "STUDENT" as const, email: { not: { contains: "example.com" } }, deletedAt: null };

async function claim(userId: string, kind: string, day: string): Promise<boolean> {
  try {
    await prisma.emailSend.create({ data: { userId, kind, day } });
    return true;
  } catch {
    return false; // already sent
  }
}

// Immediately after the Diagnostic: the score, what's weak, and that the
// first set is free. Sent from finalizeDiagnosticCompletion, best-effort.
export async function sendDiagnosticResultsEmail(studentId: string): Promise<void> {
  const [user, prediction, states] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId }, select: { email: true, firstName: true } }),
    prisma.predictionHistoryEntry.findFirst({ where: { studentId, sourceType: "DIAGNOSTIC" }, orderBy: { createdAt: "desc" } }),
    prisma.categoryState.findMany({ where: { studentId }, select: { category: true, ability: true } }),
  ]);
  if (!user || !prediction) return;
  if (!(await claim(studentId, "results", "once"))) return;
  const weak = weakestCategories(states.map((s) => ({ category: s.category, currentMastery: s.ability }))).map((c) => CATEGORY_LABELS[c]);
  await sendEmail({
    to: user.email,
    subject: `Your predicted SAT score: ${prediction.displayedRangeMinimum}–${prediction.displayedRangeMaximum}`,
    text: `Hi ${user.firstName},

You finished the Diagnostic. Your first PrepHub Score Prediction is ${prediction.displayedRangeMinimum}–${prediction.displayedRangeMaximum}.

The categories costing you the most right now: ${weak.join(" and ")}.

Your first personalized practice set is built around exactly those, and it's free. It's waiting here:
${SITE}/practice

Every set after that updates your prediction, so you can watch it move.

— Prithvi, PrepHub`,
  });
}

// Day-after nudge for anyone who signed up but hasn't finished the
// Diagnostic. Once per account, ever.
export async function sendFinishDiagnosticNudges(now = new Date()): Promise<number> {
  const lower = new Date(now.getTime() - 7 * 86400e3);
  const upper = new Date(now.getTime() - 20 * 3600e3);
  const candidates = await prisma.user.findMany({
    where: {
      ...REAL_STUDENT,
      createdAt: { gte: lower, lte: upper },
      OR: [{ diagnosticSession: null }, { diagnosticSession: { status: { not: "COMPLETED" } } }],
      emailSends: { none: { kind: "finish_diagnostic" } },
    },
    select: { id: true, email: true, firstName: true, diagnosticSession: { select: { attempts: { where: { submittedAt: { not: null } }, select: { id: true } } } } },
    take: 200,
  });
  let sent = 0;
  for (const u of candidates) {
    if (!(await claim(u.id, "finish_diagnostic", "once"))) continue;
    const answered = u.diagnosticSession?.attempts.length ?? 0;
    await sendEmail({
      to: u.email,
      subject: answered > 0 ? `You're ${answered} of 21 questions in` : "Your predicted SAT score is 21 questions away",
      text: `Hi ${u.firstName},

${
  answered > 0
    ? `You answered ${answered} of the 21 Diagnostic questions — your progress is saved, and the remaining ${21 - answered} take about ${Math.max(5, Math.round(((21 - answered) / 21) * 20))} minutes.`
    : "The Diagnostic is 21 questions, about 20 minutes, and it ends with your predicted SAT score and the categories costing you the most."
}

Pick it back up here:
${SITE}/diagnostic

Your first practice set after it is free.

— Prithvi, PrepHub`,
    });
    sent++;
  }
  return sent;
}

// The Settings toggle, finally wired. Once a day, only to students who
// have it on and haven't answered anything today. Paid students are
// pointed at their set; free students at the Daily Challenge (and their
// free set if it's still open).
export async function sendDailyReminders(now = new Date()): Promise<number> {
  const day = dayKey(now);
  const startOfDay = new Date(`${day}T00:00:00Z`);
  const candidates = await prisma.user.findMany({
    where: {
      ...REAL_STUDENT,
      dailyReminderEnabled: true,
      diagnosticSession: { status: "COMPLETED" },
      emailSends: { none: { kind: "daily_reminder", day } },
      finalizedAttempts: { none: { finalizedAt: { gte: startOfDay } } },
      dailyChallengeAttempts: { none: { answeredAt: { gte: startOfDay } } },
    },
    select: { id: true, email: true, firstName: true, subscription: { select: { status: true } } },
    take: 500,
  });
  let sent = 0;
  for (const u of candidates) {
    if (!(await claim(u.id, "daily_reminder", day))) continue;
    const paid = u.subscription?.status === "ACTIVE";
    await sendEmail({
      to: u.email,
      subject: paid ? "Today's practice set is waiting" : "Today's Daily Challenge is waiting",
      text: `Hi ${u.firstName},

${paid ? "Half a set today keeps your prediction moving. Your next questions are ready:" : "One hard question, no clock, and your streak stays alive:"}
${SITE}${paid ? "/practice" : "/daily"}

You can turn these reminders off any time in Settings → Notifications.

— PrepHub`,
    });
    sent++;
  }
  return sent;
}

export async function runDailyLifecycle(now = new Date()): Promise<{ nudges: number; reminders: number }> {
  const nudges = await sendFinishDiagnosticNudges(now);
  const reminders = await sendDailyReminders(now);
  return { nudges, reminders };
}
