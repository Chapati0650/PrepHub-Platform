import type { QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { getRecommendedPace, type RecommendedPace } from "@/lib/onboarding/study-commitment";
import { computeStudyStreak } from "./study-streak";

export type DashboardData = {
  firstName: string;
  diagnosticStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  currentRange: { min: number; max: number } | null;
  approximateImprovementSinceStart: number | null;
  weeklyQuestionsCompleted: number;
  weeklyStudyTimeSeconds: number;
  totalQuestionsAnswered: number;
  studyStreak: number;
  recentImprovements: string[];
  mastery: { category: QuestionCategory; currentMastery: number }[];
  recommendedPace: RecommendedPace | null;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Two years: longer than any streak this product can have produced, and it
// keeps the streak query from scanning a student's entire answer history.
const STREAK_HORIZON_MS = 730 * 24 * 60 * 60 * 1000;

export async function getDashboardData(studentId: string): Promise<DashboardData> {
  const [user, diagnostic] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: studentId }, select: { firstName: true, studyCommitment: true } }),
    prisma.diagnosticSession.findUnique({ where: { studentId } }),
  ]);
  const recommendedPace = user.studyCommitment ? getRecommendedPace(user.studyCommitment) : null;

  if (diagnostic?.status !== "COMPLETED") {
    return {
      firstName: user.firstName,
      diagnosticStatus: diagnostic ? "IN_PROGRESS" : "NOT_STARTED",
      currentRange: null,
      approximateImprovementSinceStart: null,
      weeklyQuestionsCompleted: 0,
      weeklyStudyTimeSeconds: 0,
      totalQuestionsAnswered: 0,
      studyStreak: 0,
      recentImprovements: [],
      mastery: [],
      recommendedPace,
    };
  }

  const since = new Date(Date.now() - WEEK_MS);
  // A study streak can only be as long as the run of consecutive days ending
  // today, so anything older than this window is irrelevant to it.
  const streakHorizon = new Date(Date.now() - STREAK_HORIZON_MS);

  const [
    recentPredictions,
    diagnosticPrediction,
    weeklyPracticeAnswers,
    weeklyDiagnosticAnswers,
    totalPracticeAnswers,
    totalDiagnosticAnswers,
    allFinalizedAttempts,
    allDiagnosticAttempts,
    completedSetsThisWeek,
    categoryStates,
    lastCompletedSet,
  ] = await Promise.all([
    prisma.predictionHistoryEntry.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, take: 2 }),
    prisma.predictionHistoryEntry.findFirst({ where: { studentId, sourceType: "DIAGNOSTIC" }, orderBy: { createdAt: "asc" } }),
    prisma.finalizedAttempt.count({ where: { studentId, finalizedAt: { gte: since } } }),
    prisma.diagnosticAttempt.count({ where: { diagnosticSession: { studentId }, submittedAt: { gte: since } } }),
    prisma.finalizedAttempt.count({ where: { studentId } }),
    prisma.diagnosticAttempt.count({ where: { diagnosticSession: { studentId }, submittedAt: { not: null } } }),
    // Only for the study streak, which walks back from today until it finds
    // a gap — so dates older than the longest possible streak can't change
    // the answer. Bounded because these were unbounded scans that grew with
    // every question a student had ever answered (2026-09-28).
    prisma.finalizedAttempt.findMany({
      where: { studentId, finalizedAt: { gte: streakHorizon } },
      select: { finalizedAt: true },
    }),
    prisma.diagnosticAttempt.findMany({
      where: { diagnosticSession: { studentId }, submittedAt: { gte: streakHorizon } },
      select: { submittedAt: true },
    }),
    prisma.practiceSet.findMany({
      where: { studentId, status: "COMPLETED", completedAt: { gte: since } },
      select: { createdAt: true, completedAt: true },
    }),
    prisma.categoryState.findMany({ where: { studentId } }),
    prisma.practiceSet.findFirst({
      where: { studentId, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      include: { categorySnapshots: true },
    }),
  ]);

  const diagnosticStudyTime =
    diagnostic.completedAt && diagnostic.completedAt >= since
      ? (diagnostic.completedAt.getTime() - diagnostic.startedAt.getTime()) / 1000
      : 0;
  const weeklyStudyTimeSeconds = Math.round(
    diagnosticStudyTime +
      completedSetsThisWeek.reduce((sum, s) => sum + (s.completedAt!.getTime() - s.createdAt.getTime()) / 1000, 0),
  );

  const activityDates = [
    ...allFinalizedAttempts.map((a) => a.finalizedAt),
    ...allDiagnosticAttempts.map((a) => a.submittedAt!),
  ];

  const abilityByCategory = new Map(categoryStates.map((s) => [s.category, s.ability]));
  const mastery = ALL_CATEGORIES.map((category) => ({ category, currentMastery: Math.round(abilityByCategory.get(category) ?? 0) }));

  // Both come from the one take:2 fetch above — the most recent entry and the
  // one before it were previously two separate round trips over the same
  // ordering.
  const [latestPrediction, previousPrediction] = recentPredictions;

  const recentImprovements: string[] = [];
  if (latestPrediction && previousPrediction && latestPrediction.representativeMidpoint > previousPrediction.representativeMidpoint) {
    recentImprovements.push(
      `Estimated SAT increased by ${latestPrediction.representativeMidpoint - previousPrediction.representativeMidpoint} points.`,
    );
  }
  if (lastCompletedSet) {
    const snapshotByCategory = new Map(lastCompletedSet.categorySnapshots.map((s) => [s.category, s.abilityAtGeneration]));
    for (const category of ALL_CATEGORIES) {
      const before = snapshotByCategory.get(category);
      const after = abilityByCategory.get(category);
      if (before !== undefined && after !== undefined && Math.round(after) - Math.round(before) >= 1) {
        recentImprovements.push(`${CATEGORY_LABELS[category]} mastery improved.`);
      }
    }
  }

  return {
    firstName: user.firstName,
    diagnosticStatus: "COMPLETED",
    currentRange: latestPrediction ? { min: latestPrediction.displayedRangeMinimum, max: latestPrediction.displayedRangeMaximum } : null,
    approximateImprovementSinceStart:
      latestPrediction && diagnosticPrediction ? latestPrediction.representativeMidpoint - diagnosticPrediction.representativeMidpoint : 0,
    weeklyQuestionsCompleted: weeklyPracticeAnswers + weeklyDiagnosticAnswers,
    weeklyStudyTimeSeconds,
    totalQuestionsAnswered: totalPracticeAnswers + totalDiagnosticAnswers,
    studyStreak: computeStudyStreak(activityDates, new Date()),
    recentImprovements: recentImprovements.slice(0, 4),
    mastery,
    recommendedPace,
  };
}
