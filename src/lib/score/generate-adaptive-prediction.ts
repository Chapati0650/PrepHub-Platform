import type { QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES, MAX_ABILITY, MIN_ABILITY } from "@/lib/adaptive/config";
import { computeAdaptivePrediction } from "./compute-adaptive-prediction";
import { SCORING_ENGINE_VERSION } from "./config";
import { ScoreError } from "./errors";

// PRD-016 §3.2 / §13.2 — generates a new prediction after a completed
// adaptive practice set. Idempotent per set: a retried call for the same
// practiceSetId must not create a second history entry (§10/§17 still want
// exactly one entry per completed set, not one per call).
export async function generateAdaptivePrediction(studentId: string, practiceSetId: string) {
  const existing = await prisma.predictionHistoryEntry.findFirst({
    where: { studentId, sourceType: "ADAPTIVE_SET", sourceSetId: practiceSetId },
  });
  if (existing) return existing;

  const practiceSet = await prisma.practiceSet.findUnique({
    where: { id: practiceSetId },
    include: { finalizedAttempts: true },
  });
  if (!practiceSet || practiceSet.studentId !== studentId || practiceSet.status !== "COMPLETED") {
    throw new ScoreError("SET_INCOMPLETE", "Practice set must be completed before a prediction can be generated.");
  }
  if (practiceSet.finalizedAttempts.length !== 21) {
    throw new ScoreError("SET_INCOMPLETE", "Practice set does not have all 21 answers finalized.");
  }

  const initialPrediction = await prisma.predictionHistoryEntry.findFirst({
    where: { studentId, sourceType: "DIAGNOSTIC" },
    orderBy: { createdAt: "asc" },
  });
  if (!initialPrediction) {
    throw new ScoreError("DIAGNOSTIC_INCOMPLETE", "No diagnostic prediction exists to use as the improvement baseline.");
  }

  const categoryStates = await prisma.categoryState.findMany({ where: { studentId } });
  if (categoryStates.length !== ALL_CATEGORIES.length) {
    throw new ScoreError("CATEGORY_STATE_MISSING", "One or more Category States are missing.");
  }
  const abilities: Record<QuestionCategory, number> = {} as Record<QuestionCategory, number>;
  for (const state of categoryStates) {
    if (state.ability < MIN_ABILITY || state.ability > MAX_ABILITY) {
      throw new ScoreError("INVALID_ABILITY", `Ability for ${state.category} is out of range: ${state.ability}`);
    }
    abilities[state.category] = state.ability;
  }

  const computed = computeAdaptivePrediction(abilities, initialPrediction.representativeMidpoint);

  return prisma.predictionHistoryEntry.create({
    data: {
      studentId,
      sourceType: "ADAPTIVE_SET",
      sourceSetId: practiceSetId,
      readingWritingAbility: computed.readingWritingAbility,
      mathAbility: computed.mathAbility,
      overallAbility: computed.overallAbility,
      internalDiagnosticEstimate: null,
      displayedRangeIndex: computed.range.index,
      displayedRangeMinimum: computed.range.scoreMin,
      displayedRangeMaximum: computed.range.scoreMax,
      representativeMidpoint: computed.range.midpoint,
      approximateImprovement: computed.approximateImprovement,
      withinRangeProgress: computed.withinRangeProgress,
      scoringEngineVersion: SCORING_ENGINE_VERSION,
    },
  });
}
