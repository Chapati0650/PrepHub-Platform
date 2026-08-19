import type { QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";

export type SessionResultsData = {
  sourceType: "DIAGNOSTIC" | "ADAPTIVE_SET";
  previousRange: { min: number; max: number } | null;
  currentRange: { min: number; max: number };
  approximateImprovement: number;
  targetScore: number | null;
  stats: { correct: number; total: number; accuracy: number; avgTimeSeconds: number; totalTimeSeconds: number };
  mastery: { category: QuestionCategory; currentMastery: number; changeSinceStart: number | null }[];
  questions: { id: string; position: number; isCorrect: boolean; category: QuestionCategory }[];
  continueHref: string;
};

// Session-level total/completedAt - startedAt divided evenly across the 21
// questions. We don't persist per-question timing (PRD-012 §15: response time
// never affects adaptivity or scoring, so it was never modeled as more than a
// display nicety) — this derives the two required display stats from the
// timestamps we do have rather than adding storage purely for a stat.
function timeStats(startedAt: Date, completedAt: Date, questionCount: number) {
  const totalSessionTime = Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000));
  return {
    totalTimeSeconds: totalSessionTime,
    avgTimeSeconds: questionCount === 0 ? 0 : Math.round(totalSessionTime / questionCount),
  };
}

export async function getDiagnosticResultsData(studentId: string): Promise<SessionResultsData> {
  const [session, prediction, categoryStates, user] = await Promise.all([
    prisma.diagnosticSession.findUniqueOrThrow({ where: { studentId }, include: { attempts: { orderBy: { position: "asc" } } } }),
    prisma.predictionHistoryEntry.findFirstOrThrow({ where: { studentId, sourceType: "DIAGNOSTIC" } }),
    prisma.categoryState.findMany({ where: { studentId } }),
    prisma.user.findUniqueOrThrow({ where: { id: studentId }, select: { targetScore: true } }),
  ]);

  const abilityByCategory = new Map(categoryStates.map((s) => [s.category, s.ability]));
  const correct = session.attempts.filter((a) => a.isCorrect).length;

  return {
    sourceType: "DIAGNOSTIC",
    previousRange: null,
    currentRange: { min: prediction.displayedRangeMinimum, max: prediction.displayedRangeMaximum },
    approximateImprovement: 0,
    targetScore: user.targetScore,
    stats: {
      correct,
      total: session.attempts.length,
      accuracy: session.attempts.length === 0 ? 0 : Math.round((correct / session.attempts.length) * 100),
      ...timeStats(session.startedAt, session.completedAt ?? new Date(), session.attempts.length),
    },
    mastery: ALL_CATEGORIES.map((category) => ({
      category,
      currentMastery: Math.round(abilityByCategory.get(category) ?? 0),
      changeSinceStart: null,
    })),
    questions: session.attempts.map((a) => ({ id: a.id, position: a.position, isCorrect: !!a.isCorrect, category: a.category })),
    continueHref: "/practice",
  };
}

export async function getPracticeSetResultsData(studentId: string, practiceSetId: string): Promise<SessionResultsData> {
  const [set, prediction, categoryStates, user] = await Promise.all([
    prisma.practiceSet.findUniqueOrThrow({
      where: { id: practiceSetId },
      include: {
        slots: { orderBy: { position: "asc" }, include: { finalizedAttempt: true } },
        categorySnapshots: true,
      },
    }),
    prisma.predictionHistoryEntry.findFirstOrThrow({ where: { studentId, sourceType: "ADAPTIVE_SET", sourceSetId: practiceSetId } }),
    prisma.categoryState.findMany({ where: { studentId } }),
    prisma.user.findUniqueOrThrow({ where: { id: studentId }, select: { targetScore: true } }),
  ]);

  if (set.studentId !== studentId) throw new Error("Practice set not found for this student.");

  const previousPrediction = await prisma.predictionHistoryEntry.findFirst({
    where: { studentId, createdAt: { lt: prediction.createdAt } },
    orderBy: { createdAt: "desc" },
  });

  const abilityByCategory = new Map(categoryStates.map((s) => [s.category, s.ability]));
  const snapshotByCategory = new Map(set.categorySnapshots.map((s) => [s.category, s.abilityAtGeneration]));
  const correct = set.slots.filter((s) => s.finalizedAttempt?.isCorrect).length;

  return {
    sourceType: "ADAPTIVE_SET",
    previousRange: previousPrediction
      ? { min: previousPrediction.displayedRangeMinimum, max: previousPrediction.displayedRangeMaximum }
      : null,
    currentRange: { min: prediction.displayedRangeMinimum, max: prediction.displayedRangeMaximum },
    approximateImprovement: prediction.approximateImprovement,
    targetScore: user.targetScore,
    stats: {
      correct,
      total: set.slots.length,
      accuracy: Math.round((correct / set.slots.length) * 100),
      ...timeStats(set.createdAt, set.completedAt ?? new Date(), set.slots.length),
    },
    mastery: ALL_CATEGORIES.map((category) => {
      const before = snapshotByCategory.get(category);
      const after = abilityByCategory.get(category) ?? 0;
      return {
        category,
        currentMastery: Math.round(after),
        changeSinceStart: before !== undefined ? Math.round(after) - Math.round(before) : null,
      };
    }),
    questions: set.slots.map((s) => ({
      id: s.id,
      position: s.position,
      isCorrect: !!s.finalizedAttempt?.isCorrect,
      category: s.resolvedCategory,
    })),
    continueHref: "/practice",
  };
}
