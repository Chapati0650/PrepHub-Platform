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
//
// Also called by the results page, which generates the prediction there if
// the set's completion committed and this step then failed — otherwise that
// results page would fail on every visit with nothing ever retrying it.
export async function generateAdaptivePrediction(studentId: string, practiceSetId: string) {
  // The fast path, and the one every results-page visit takes.
  const existing = await prisma.predictionHistoryEntry.findFirst({
    where: { studentId, sourceType: "ADAPTIVE_SET", sourceSetId: practiceSetId },
  });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    // Two calls can both miss the check above — a double-clicked Finish, or a
    // retry racing the results page — and under READ COMMITTED both would
    // then write an entry. Locking the set's row makes the second wait until
    // the first commits, and its re-check below then finds that entry. (A
    // unique index on sourceSetId would also do it, but needs a migration.)
    await tx.$queryRaw`SELECT "id" FROM "practice_sets" WHERE "id" = ${practiceSetId} FOR UPDATE`;
    const written = await tx.predictionHistoryEntry.findFirst({
      where: { studentId, sourceType: "ADAPTIVE_SET", sourceSetId: practiceSetId },
    });
    if (written) return written;

    const practiceSet = await tx.practiceSet.findUnique({
      where: { id: practiceSetId },
      include: { finalizedAttempts: true },
    });
    if (!practiceSet || practiceSet.studentId !== studentId || practiceSet.status !== "COMPLETED") {
      throw new ScoreError("SET_INCOMPLETE", "Practice set must be completed before a prediction can be generated.");
    }
    if (practiceSet.finalizedAttempts.length !== 21) {
      throw new ScoreError("SET_INCOMPLETE", "Practice set does not have all 21 answers finalized.");
    }

    const initialPrediction = await tx.predictionHistoryEntry.findFirst({
      where: { studentId, sourceType: "DIAGNOSTIC" },
      orderBy: { createdAt: "asc" },
    });
    if (!initialPrediction) {
      throw new ScoreError("DIAGNOSTIC_INCOMPLETE", "No diagnostic prediction exists to use as the improvement baseline.");
    }

    const categoryStates = await tx.categoryState.findMany({ where: { studentId } });
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

    return tx.predictionHistoryEntry.create({
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
  });
}
