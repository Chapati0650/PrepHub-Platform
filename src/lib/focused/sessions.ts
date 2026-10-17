import type { FocusedDifficulty, QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createRandom, generateSeed } from "@/lib/adaptive/random";
import { isAnswerCorrect } from "@/lib/adaptive/grading";
import {
  FOCUSED_CATEGORY_LABELS,
  FOCUSED_CATEGORY_ORDER,
  FOCUSED_DIFFICULTY_LABELS,
  FOCUSED_SESSION_SIZE,
} from "./config";
import { FOCUSED_DIFFICULTY_POOLS, selectFocusedQuestions } from "./select-questions";
import { FocusedError } from "./errors";

// Everything here is deliberately independent of src/lib/adaptive: Focused
// Practice never reads or writes CategoryState, PracticeSet, FinalizedAttempt
// or PredictionHistoryEntry. It borrows two pure helpers (the seeded PRNG and
// the answer grader) and nothing that carries state.
//
// That isolation is what makes the feature safe. A student choosing their own
// category and difficulty is a self-selected sample, and both PRD-014's
// ability update and PRD-016's prediction assume the engine chose the
// questions. If a drill moved the Predicted SAT Score, a student could farm
// Easy questions in their strongest category and watch a number climb that no
// longer meant anything — and the school-facing CCMR reporting built on those
// same predictions would inherit the distortion.

export type FocusedCategoryOverview = {
  category: QuestionCategory;
  label: string;
  /** Published question counts per difficulty, so the picker can disable empties. */
  counts: Record<FocusedDifficulty, number>;
  attempted: number;
  correct: number;
  accuracy: number | null;
  activeSessionId: string | null;
};

export type FocusedAnalytics = {
  attempted: number;
  correct: number;
  accuracy: number | null;
  sessionsCompleted: number;
};

export async function getFocusedOverview(studentId: string): Promise<{
  categories: FocusedCategoryOverview[];
  analytics: FocusedAnalytics;
}> {
  const [pool, active, slots, sessionsCompleted] = await Promise.all([
    // One grouped count rather than 7 x 4 separate counts.
    prisma.question.groupBy({
      by: ["category", "difficulty"],
      where: { status: "PUBLISHED", currentPublishedRevisionId: { not: null } },
      _count: { _all: true },
    }),
    prisma.focusedSession.findMany({
      where: { studentId, status: "ACTIVE" },
      select: { id: true, category: true },
    }),
    prisma.focusedSlot.findMany({
      where: { session: { studentId }, finalizedAt: { not: null } },
      select: { isCorrect: true, question: { select: { category: true } } },
    }),
    prisma.focusedSession.count({ where: { studentId, status: "COMPLETED" } }),
  ]);

  const published = new Map<string, number>();
  for (const row of pool) published.set(`${row.category}:${row.difficulty}`, row._count._all);

  const categories = FOCUSED_CATEGORY_ORDER.map((category) => {
    const easy = published.get(`${category}:EASY`) ?? 0;
    const medium = published.get(`${category}:MEDIUM`) ?? 0;
    const hard = published.get(`${category}:HARD`) ?? 0;
    const mine = slots.filter((s) => s.question.category === category);
    const correct = mine.filter((s) => s.isCorrect).length;
    return {
      category,
      label: FOCUSED_CATEGORY_LABELS[category],
      counts: { EASY: easy, MEDIUM: medium, HARD: hard, MIXED: easy + medium + hard },
      attempted: mine.length,
      correct,
      accuracy: mine.length > 0 ? Math.round((correct / mine.length) * 100) : null,
      activeSessionId: active.find((a) => a.category === category)?.id ?? null,
    };
  });

  const attempted = slots.length;
  const correct = slots.filter((s) => s.isCorrect).length;

  return {
    categories,
    analytics: {
      attempted,
      correct,
      accuracy: attempted > 0 ? Math.round((correct / attempted) * 100) : null,
      sessionsCompleted,
    },
  };
}

/**
 * Returns the student's ACTIVE session for this category, or creates one.
 *
 * Scoped per category rather than per student, matching the 800 Club: a
 * half-finished Algebra drill is not destroyed by starting a Grammar one. The
 * difficulty is not part of the key — reopening a category resumes whatever
 * drill is open in it, rather than silently starting a second.
 */
export async function openFocusedSession(
  studentId: string,
  category: QuestionCategory,
  difficulty: FocusedDifficulty,
): Promise<{ id: string }> {
  const existing = await prisma.focusedSession.findFirst({
    where: { studentId, category, status: "ACTIVE" },
    select: { id: true },
  });
  if (existing) return existing;

  const [candidates, seen] = await Promise.all([
    prisma.question.findMany({
      where: {
        status: "PUBLISHED",
        category,
        difficulty: { in: [...FOCUSED_DIFFICULTY_POOLS[difficulty]] },
        currentPublishedRevisionId: { not: null },
      },
      select: { id: true, currentPublishedRevisionId: true, difficulty: true },
    }),
    // Seen means seen *in a Focused Practice session*. Deliberately not
    // every question the student has ever met: excluding Diagnostic and
    // Practice Set questions too would make a thin category unusable, and
    // revisiting a question you got wrong in a set is a reasonable thing for
    // a drill to do.
    prisma.focusedSlot.findMany({
      where: { session: { studentId }, finalizedAt: { not: null } },
      select: { questionId: true },
      distinct: ["questionId"],
    }),
  ]);

  const randomSeed = generateSeed();
  const picked = selectFocusedQuestions({
    candidates: candidates.map((c) => ({
      questionId: c.id,
      questionRevisionId: c.currentPublishedRevisionId!,
      difficulty: c.difficulty,
    })),
    seenQuestionIds: new Set(seen.map((s) => s.questionId)),
    difficulty,
    size: FOCUSED_SESSION_SIZE,
    random: createRandom(randomSeed),
  });

  if (picked.length === 0) {
    throw new FocusedError(
      "NO_QUESTIONS",
      `There are no published ${FOCUSED_DIFFICULTY_LABELS[difficulty].toLowerCase()} questions in ${FOCUSED_CATEGORY_LABELS[category]} yet.`,
    );
  }

  return prisma.focusedSession.create({
    data: {
      studentId,
      category,
      difficulty,
      randomSeed,
      slots: {
        create: picked.map((p, position) => ({
          position,
          questionId: p.questionId,
          questionRevisionId: p.questionRevisionId,
        })),
      },
    },
    select: { id: true },
  });
}

// Idempotent: a retried submit returns the first recorded answer rather than
// grading again. The check and the write are one transaction.
export async function finalizeFocusedAnswer(params: {
  studentId: string;
  slotId: string;
  answer: string;
}) {
  return prisma.$transaction(async (tx) => {
    const slot = await tx.focusedSlot.findUnique({
      where: { id: params.slotId },
      include: {
        session: true,
        question: true,
        questionRevision: { include: { answerChoices: true } },
      },
    });
    if (!slot || slot.session.studentId !== params.studentId) {
      throw new FocusedError("SLOT_NOT_FOUND", "Question not found.");
    }
    if (slot.finalizedAt) return { isCorrect: slot.isCorrect ?? false, answer: slot.answer ?? "" };
    if (slot.session.status === "COMPLETED") {
      throw new FocusedError("SESSION_COMPLETED", "This session is already complete.");
    }

    const isCorrect = isAnswerCorrect(slot.question.questionType, params.answer, slot.questionRevision);
    await tx.focusedSlot.update({
      where: { id: slot.id },
      data: { answer: params.answer, isCorrect, finalizedAt: new Date(), draftAnswer: null, skipped: false },
    });
    return { isCorrect, answer: params.answer };
  });
}

// Same product rule as a Practice Set (PRD-005 §21): every question must be
// answered before the session completes. No blank-confirmation bypass.
export async function completeFocusedSession(studentId: string, sessionId: string): Promise<void> {
  const session = await prisma.focusedSession.findUnique({
    where: { id: sessionId },
    include: { slots: { select: { finalizedAt: true } } },
  });
  if (!session || session.studentId !== studentId) {
    throw new FocusedError("SESSION_NOT_FOUND", "Session not found.");
  }
  if (session.status === "COMPLETED") return;
  const unanswered = session.slots.filter((s) => !s.finalizedAt).length;
  if (unanswered > 0) {
    throw new FocusedError(
      "BLANKS_REMAIN",
      `${unanswered} question${unanswered === 1 ? "" : "s"} remain unanswered.`,
      { unanswered },
    );
  }
  await prisma.focusedSession.update({
    where: { id: sessionId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

export async function getFocusedSessionForRunner(studentId: string, sessionId: string) {
  const session = await prisma.focusedSession.findUnique({
    where: { id: sessionId },
    include: { slots: { orderBy: { position: "asc" } } },
  });
  if (!session || session.studentId !== studentId) return null;
  return session;
}

export type FocusedResults = {
  sessionId: string;
  category: QuestionCategory;
  categoryLabel: string;
  difficulty: FocusedDifficulty;
  difficultyLabel: string;
  total: number;
  correct: number;
  accuracy: number;
  totalSeconds: number | null;
  questions: { slotId: string; position: number; isCorrect: boolean; category: string }[];
};

export async function getFocusedResults(
  studentId: string,
  sessionId: string,
): Promise<FocusedResults | null> {
  const session = await prisma.focusedSession.findUnique({
    where: { id: sessionId },
    include: {
      slots: { orderBy: { position: "asc" }, include: { question: { select: { category: true } } } },
    },
  });
  if (!session || session.studentId !== studentId || session.status !== "COMPLETED") return null;
  const total = session.slots.length;
  const correct = session.slots.filter((s) => s.isCorrect).length;
  return {
    sessionId: session.id,
    category: session.category,
    categoryLabel: FOCUSED_CATEGORY_LABELS[session.category],
    difficulty: session.difficulty,
    difficultyLabel: FOCUSED_DIFFICULTY_LABELS[session.difficulty],
    total,
    correct,
    accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
    totalSeconds: session.completedAt
      ? Math.round((session.completedAt.getTime() - session.createdAt.getTime()) / 1000)
      : null,
    questions: session.slots.map((s) => ({
      slotId: s.id,
      position: s.position,
      isCorrect: s.isCorrect ?? false,
      category: s.question.category,
    })),
  };
}
