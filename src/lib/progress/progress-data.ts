import type { QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { emptyStudentActivity, getStudentActivity } from "@/lib/school/student-activity";
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

  // Study Statistics count every study mode — the Daily Challenge, 800 Club,
  // Rush, Focused Practice and homework as well as the Diagnostic and
  // Practice Sets. They used to count the last two only, so a student's
  // homework and rushes never showed here, and "Questions Answered" disagreed
  // with the dashboard's figure of the same name. `getStudentActivity` is the
  // same definition the student's school sees, session-length cap included.
  const [predictions, categoryStates, activityByStudent, completedSets] = await Promise.all([
    prisma.predictionHistoryEntry.findMany({ where: { studentId }, orderBy: { createdAt: "asc" } }),
    prisma.categoryState.findMany({ where: { studentId } }),
    getStudentActivity([studentId]),
    // Only to label each prediction with its set number.
    prisma.practiceSet.findMany({
      where: { studentId, status: "COMPLETED" },
      select: { id: true, setNumber: true },
    }),
  ]);
  const activity = activityByStudent.get(studentId) ?? emptyStudentActivity();

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
  // The journey narrative is about the prediction, which only Practice Sets
  // move, so it counts those alone.
  const completedPracticeSets = predictions.filter((p) => p.sourceType === "ADAPTIVE_SET").length;

  // Every finished session of any kind, the Diagnostic included, so the time
  // and the count it's averaged over come from the same rows.
  const completedSessions = activity.sessionsCompleted;
  const totalQuestionsAnswered = activity.questionsAnswered;
  const totalStudyTimeSeconds = Math.round(activity.studyHours * 3600);
  const averageSessionLengthSeconds = completedSessions > 0 ? Math.round(totalStudyTimeSeconds / completedSessions) : 0;

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
      completedSessions: completedPracticeSets,
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
