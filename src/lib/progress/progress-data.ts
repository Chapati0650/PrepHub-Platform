import type { QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { emptyStudentActivity, getStudentActivity } from "@/lib/school/student-activity";
import { buildJourneyNarrative } from "./journey-narrative";
import { computeMilestones } from "./milestones";
import { generateDiagnosticPrediction } from "@/lib/score/generate-diagnostic-prediction";
import { SCORE_RANGES } from "@/lib/score/config";
import { hasPointEstimate, predictionView } from "@/lib/score/display";

export type ProgressHistoryPoint = {
  label: string; // "Diagnostic" or "Set 4"
  date: Date;
  min: number;
  max: number;
  /** The predicted score, for entries from engine 2026.3 on. */
  point: number | null;
  /** Scored by an earlier engine than the latest entry, so never compared with it. */
  earlierMethod: boolean;
  /** Where that Diagnostic's or set's results reopen (review, 2026-11-09: nothing linked to them). */
  href: string | null;
};

export type ProgressData =
  | { diagnosticStatus: "NOT_STARTED" | "IN_PROGRESS" }
  | {
      diagnosticStatus: "COMPLETED";
      currentRange: { min: number; max: number; point: number | null };
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
  const [storedPredictions, categoryStates, activityByStudent, completedSets] = await Promise.all([
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
  // Completion commits before the first prediction is written; if that second
  // step failed, there is a finished Diagnostic and no prediction. Generated
  // here (it's idempotent) as the results page does, rather than failing this
  // page on every visit.
  const predictions =
    storedPredictions.length > 0 ? storedPredictions : [await generateDiagnosticPrediction(studentId)];

  const latest = predictions[predictions.length - 1];
  const setById = new Map(completedSets.map((s) => [s.id, s]));
  const history: ProgressHistoryPoint[] = predictions.map((p) => {
    const earlierMethod = p.scoringEngineVersion !== latest.scoringEngineVersion;
    const { min, max, point } = predictionView(p);
    const range = { date: p.createdAt, min, max, point, earlierMethod };
    if (p.sourceType === "DIAGNOSTIC") return { label: "Diagnostic", ...range, href: "/diagnostic/results" };
    const set = p.sourceSetId ? setById.get(p.sourceSetId) : undefined;
    return { label: set ? `Set ${set.setNumber}` : "Set", ...range, href: set ? `/practice/results/${set.id}` : null };
  });

  // Where the student started, as the engine behind the latest prediction
  // scores it: a Practice Set entry stores its distance from the Diagnostic
  // measured that way (generate-adaptive-prediction.ts). For a student who
  // started before the recalibration of 2026-11-06 this is not their first
  // stored entry, which came from a different engine.
  const startMid =
    latest.sourceType === "ADAPTIVE_SET" ? latest.representativeMidpoint - latest.approximateImprovement : latest.representativeMidpoint;
  // From 2026.3 the start is a score, not one of fifteen ranges.
  const latestHasPoint = hasPointEstimate(latest.scoringEngineVersion);
  const startBand = latestHasPoint ? undefined : SCORE_RANGES.find((r) => r.midpoint === startMid);
  const startingRange = startBand ? { min: startBand.scoreMin, max: startBand.scoreMax } : (history[0] ?? { min: 400, max: 480 });
  const currentRange = predictionView(latest);
  const currentScore = currentRange.point ?? currentRange.max;
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
  const remainingToTarget = targetScore !== null ? Math.max(0, targetScore - currentScore) : null;
  // Midpoint to midpoint, so the bar is empty on the day of the Diagnostic.
  // It went from the starting range's bottom to the current range's top, which
  // counted the range's own width (60-80 points) as progress before any work.
  const targetProgressFraction =
    targetScore !== null && targetScore > startMid
      ? Math.min(1, Math.max(0, (latest.representativeMidpoint - startMid) / (targetScore - startMid)))
      : null;

  const weakestSkills = [...categoryStates]
    .sort((a, b) => a.ability - b.ability)
    .slice(0, 3)
    .map((s) => ({ category: s.category, label: CATEGORY_LABELS[s.category] }));
  // If fewer than 7 categories have state for some reason, fall back gracefully.
  if (weakestSkills.length === 0) {
    weakestSkills.push(...ALL_CATEGORIES.slice(0, 3).map((c) => ({ category: c, label: CATEGORY_LABELS[c] })));
  }

  const highestPredictedScore = Math.max(
    ...predictions
      .filter((p) => p.scoringEngineVersion === latest.scoringEngineVersion)
      .map((p) => (hasPointEstimate(p.scoringEngineVersion) ? p.representativeMidpoint : p.displayedRangeMaximum)),
  );

  return {
    diagnosticStatus: "COMPLETED",
    currentRange,
    targetScore,
    remainingToTarget,
    targetProgressFraction,
    history,
    journeyNarrative: buildJourneyNarrative({
      startingRange: { min: startingRange.min, max: startingRange.max },
      startingPoint: latestHasPoint ? startMid : null,
      completedSessions: completedPracticeSets,
      totalQuestionsAnswered,
      totalImprovement: latest.representativeMidpoint - startMid,
      greatestImprovement,
      targetScore,
      currentRangeMax: currentScore,
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
