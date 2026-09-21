import { prisma } from "@/lib/prisma";
import { createRandom } from "@/lib/adaptive/random";
import { isAnswerCorrect } from "@/lib/adaptive/grading";
import { getStudentQuestionContent, getStudentQuestionFeedback, type StudentQuestionContent, type StudentQuestionFeedback } from "@/lib/session/question-content";
import { FUNNEL_EVENTS, track } from "@/lib/analytics/track";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import type { QuestionCategory } from "@/generated/prisma/client";

// One hard question a day, the same one for everyone, free for every
// account (Owner decision, 2026-09-21). Outside the adaptive engine: an
// answer here never touches CategoryState or the prediction — it's a
// reason to open the app, and a small taste of the 800 Club.

// UTC day key. A student in California sees the new question at 5pm
// rather than midnight, which is fine — "the day's question" is one
// question per calendar day, not per time zone, so a streak can't be
// gamed by travelling.
export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

// Picks (and pins) the day's question on first request. Seeded by the
// day so two concurrent first requests pick the same question; the unique
// on `day` makes the second insert a no-op read. Prefers questions no
// previous day has used, so the rotation covers the bank before repeating.
export async function getOrCreateDailyChallenge(day = dayKey()) {
  const existing = await prisma.dailyChallenge.findUnique({ where: { day } });
  if (existing) return existing;

  const [pool, used] = await Promise.all([
    prisma.question.findMany({
      where: { status: "PUBLISHED", difficulty: "HARD", currentPublishedRevisionId: { not: null } },
      select: { id: true, currentPublishedRevisionId: true },
      orderBy: { id: "asc" },
    }),
    prisma.dailyChallenge.findMany({ select: { questionId: true } }),
  ]);
  if (pool.length === 0) return null;
  const usedIds = new Set(used.map((u) => u.questionId));
  const fresh = pool.filter((q) => !usedIds.has(q.id));
  const candidates = fresh.length > 0 ? fresh : pool;
  const random = createRandom(`daily:${day}`);
  const pick = candidates[Math.floor(random() * candidates.length)];

  try {
    return await prisma.dailyChallenge.create({
      data: { day, questionId: pick.id, questionRevisionId: pick.currentPublishedRevisionId! },
    });
  } catch {
    // Lost the race to another request for the same day.
    return prisma.dailyChallenge.findUnique({ where: { day } });
  }
}

export type DailyChallengeView = {
  day: string;
  challengeId: string;
  category: QuestionCategory;
  categoryLabel: string;
  content: StudentQuestionContent;
  // Only after this student has answered — never before.
  attempt: { answer: string; isCorrect: boolean; feedback: StudentQuestionFeedback } | null;
  streak: number;
  answeredToday: boolean;
  // How many students have answered today, and how many of them got it —
  // the one social number this page shows.
  today: { answered: number; correct: number };
};

export async function getDailyChallengeView(studentId: string): Promise<DailyChallengeView | null> {
  const challenge = await getOrCreateDailyChallenge();
  if (!challenge) return null;
  const [content, attempt, question, counts, streak] = await Promise.all([
    getStudentQuestionContent(challenge.questionRevisionId),
    prisma.dailyChallengeAttempt.findUnique({ where: { challengeId_studentId: { challengeId: challenge.id, studentId } } }),
    prisma.question.findUniqueOrThrow({ where: { id: challenge.questionId }, select: { category: true } }),
    prisma.dailyChallengeAttempt.groupBy({ by: ["isCorrect"], where: { challengeId: challenge.id }, _count: { _all: true } }),
    getStreak(studentId),
  ]);
  const answered = counts.reduce((a, c) => a + c._count._all, 0);
  const correct = counts.find((c) => c.isCorrect)?._count._all ?? 0;
  return {
    day: challenge.day,
    challengeId: challenge.id,
    category: question.category,
    categoryLabel: CATEGORY_LABELS[question.category],
    content,
    attempt: attempt ? { answer: attempt.answer, isCorrect: attempt.isCorrect, feedback: await getStudentQuestionFeedback(challenge.questionRevisionId) } : null,
    streak,
    answeredToday: attempt !== null,
    today: { answered, correct },
  };
}

// Idempotent: a second submit for the same day returns the first answer.
export async function answerDailyChallenge(studentId: string, challengeId: string, answer: string) {
  const challenge = await prisma.dailyChallenge.findUnique({
    where: { id: challengeId },
    include: { question: true, questionRevision: { include: { answerChoices: true } } },
  });
  if (!challenge) throw new Error("Challenge not found.");
  if (challenge.day !== dayKey()) throw new Error("That challenge is over — today's is waiting.");
  const existing = await prisma.dailyChallengeAttempt.findUnique({ where: { challengeId_studentId: { challengeId, studentId } } });
  if (existing) return { isCorrect: existing.isCorrect };
  const isCorrect = isAnswerCorrect(challenge.question.questionType, answer, challenge.questionRevision);
  try {
    await prisma.dailyChallengeAttempt.create({ data: { challengeId, studentId, answer, isCorrect } });
  } catch {
    const again = await prisma.dailyChallengeAttempt.findUniqueOrThrow({ where: { challengeId_studentId: { challengeId, studentId } } });
    return { isCorrect: again.isCorrect };
  }
  void track(FUNNEL_EVENTS.DAILY_CHALLENGE_ANSWERED, { userId: studentId });
  return { isCorrect };
}

// Consecutive days answered, counting back from today (or from yesterday
// if today isn't answered yet — a streak isn't broken until the day is).
export async function getStreak(studentId: string): Promise<number> {
  const attempts = await prisma.dailyChallengeAttempt.findMany({
    where: { studentId },
    select: { challenge: { select: { day: true } } },
    orderBy: { answeredAt: "desc" },
    take: 400,
  });
  const days = new Set(attempts.map((a) => a.challenge.day));
  return streakFromDays(days, dayKey());
}

// Pure, so it's testable: how many consecutive days ending today (or
// yesterday) appear in the set.
export function streakFromDays(days: ReadonlySet<string>, today: string): number {
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!days.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let n = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    n++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return n;
}

// For the dashboard row: answered today? and the streak. Doesn't create
// the day's challenge — the /daily page does that on first visit.
export async function getDailyStatus(studentId: string): Promise<{ answeredToday: boolean; streak: number }> {
  const [today, streak] = await Promise.all([
    prisma.dailyChallengeAttempt.findFirst({ where: { studentId, challenge: { day: dayKey() } }, select: { id: true } }),
    getStreak(studentId),
  ]);
  return { answeredToday: today !== null, streak };
}
