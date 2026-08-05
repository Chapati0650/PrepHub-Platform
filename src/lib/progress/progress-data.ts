import type { QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { buildJourneyNarrative } from "./journey-narrative";
import { computeMilestones } from "./milestones";

export type ProgressHistoryPoint = {
  label: string; // "Diagnostic" or "Set 4"
  date: Date;
  min: number;
  max: number;
};

export type ProgressData =
  | { diagnosticStatus: "NOT_STARTED" | "IN_PROGRESS" }
  | {
      diagnosticStatus: "COMPLETED";
      currentRange: { min: number; max: number };
      targetScore: number | null;
      remainingToTarget: number | null;
      targetProgressFraction: number | null;
      history: ProgressHistoryPoint[];
      journeyNarrative: string;
      milestones: string[];
      studyStats: { totalStudyTimeSeconds: number; averageSessionLengthSeconds: number; totalQuestionsAnswered: number; completedSessions: number };
      weakestSkills: { category: QuestionCategory; label: string }[];
    };

export async function getProgressData(studentId: string): Promise<ProgressData> {
  const [user, diagnostic] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: studentId }, select: { targetScore: true } }),
    prisma.diagnosticSession.findUnique({ where: { studentId } }),
  ]);

  if (diagnostic?.status !== "COMPLETED") {
    return { diagnosticStatus: diagnostic ? "IN_PROGRESS" : "NOT_STARTED" };
  }

  const [predictions, categoryStates, totalPracticeAnswers, totalDiagnosticAnswers, completedSets] = await Promise.all([
    prisma.predictionHistoryEntry.findMany({ where: { studentId }, orderBy: { createdAt: "asc" } }),
    prisma.categoryState.findMany({ where: { studentId } }),
    prisma.finalizedAttempt.count({ where: { studentId } }),
    prisma.diagnosticAttempt.count({ where: { diagnosticSession: { studentId }, submittedAt: { not: null } } }),
    prisma.practiceSet.findMany({
      where: { studentId, status: "COMPLETED" },
      select: { id: true, setNumber: true, createdAt: true, completedAt: true },
    }),
  ]);

  const setById = new Map(completedSets.map((s) => [s.id, s]));
  const history: ProgressHistoryPoint[] = predictions.map((p) => {
    if (p.sourceType === "DIAGNOSTIC") {
      return { label: "Diagnostic", date: p.createdAt, min: p.displayedRangeMinimum, max: p.displayedRangeMaximum };
    }
    const set = p.sourceSetId ? setById.get(p.sourceSetId) : undefined;
    return { label: set ? `Set ${set.setNumber}` : "Set", date: p.createdAt, min: p.displayedRangeMinimum, max: p.displayedRangeMaximum };
  });

  const startingRange = history[0] ?? { min: 400, max: 480 };
  const latest = predictions[predictions.length - 1];
  const currentRange = { min: latest.displayedRangeMinimum, max: latest.displayedRangeMaximum };
  const completedSessions = predictions.filter((p) => p.sourceType === "ADAPTIVE_SET").length;

  const totalQuestionsAnswered = totalPracticeAnswers + totalDiagnosticAnswers;

  const diagnosticStudyTime = diagnostic.completedAt
    ? (diagnostic.completedAt.getTime() - diagnostic.startedAt.getTime()) / 1000
    : 0;
  const totalStudyTimeSeconds = Math.round(
    diagnosticStudyTime + completedSets.reduce((sum, s) => sum + (s.completedAt!.getTime() - s.createdAt.getTime()) / 1000, 0),
  );
  const totalSessionsIncludingDiagnostic = completedSessions + 1;
  const averageSessionLengthSeconds = Math.round(totalStudyTimeSeconds / totalSessionsIncludingDiagnostic);

  let greatestImprovement: { category: QuestionCategory; deltaPoints: number } | null = null;
  for (const state of categoryStates) {
    const delta = Math.round(state.ability) - Math.round(state.initialAbility);
    if (greatestImprovement === null || delta > greatestImprovement.deltaPoints) {
      greatestImprovement = { category: state.category, deltaPoints: delta };
    }
  }

  const targetScore = user.targetScore;
  const remainingToTarget = targetScore !== null ? Math.max(0, targetScore - currentRange.max) : null;
  const targetProgressFraction =
    targetScore !== null && targetScore > startingRange.min
      ? Math.min(1, Math.max(0, (currentRange.max - startingRange.min) / (targetScore - startingRange.min)))
      : null;

  const weakestSkills = [...categoryStates]
    .sort((a, b) => a.ability - b.ability)
    .slice(0, 3)
    .map((s) => ({ category: s.category, label: CATEGORY_LABELS[s.category] }));
  // If fewer than 7 categories have state for some reason, fall back gracefully.
  if (weakestSkills.length === 0) {
    weakestSkills.push(...ALL_CATEGORIES.slice(0, 3).map((c) => ({ category: c, label: CATEGORY_LABELS[c] })));
  }

  const highestPredictedScore = Math.max(...predictions.map((p) => p.displayedRangeMaximum));

  return {
    diagnosticStatus: "COMPLETED",
    currentRange,
    targetScore,
    remainingToTarget,
    targetProgressFraction,
    history,
    journeyNarrative: buildJourneyNarrative({
      startingRange: { min: startingRange.min, max: startingRange.max },
      completedSessions,
      totalQuestionsAnswered,
      totalImprovement: latest.representativeMidpoint - predictions[0].representativeMidpoint,
      greatestImprovement,
      targetScore,
      currentRangeMax: currentRange.max,
    }),
    milestones: computeMilestones({
      totalStudyTimeSeconds,
      totalQuestionsAnswered,
      completedSessions,
      highestPredictedScore,
    }),
    studyStats: { totalStudyTimeSeconds, averageSessionLengthSeconds, totalQuestionsAnswered, completedSessions },
    weakestSkills,
  };
}
