import type { QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES, MAX_ABILITY, MIN_ABILITY } from "@/lib/adaptive/config";
import { computeAdaptivePrediction } from "./compute-adaptive-prediction";
import { SCORING_ENGINE_VERSION, progressWithinRange } from "./config";
import { loadAnswerHistory } from "./answer-history";
import { predictScore } from "./predict";
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
    const initialAbilities: Record<QuestionCategory, number> = {} as Record<QuestionCategory, number>;
    for (const state of categoryStates) {
      if (state.ability < MIN_ABILITY || state.ability > MAX_ABILITY) {
        throw new ScoreError("INVALID_ABILITY", `Ability for ${state.category} is out of range: ${state.ability}`);
      }
      abilities[state.category] = state.ability;
      initialAbilities[state.category] = state.initialAbility;
    }

    // The improvement baseline is the Diagnostic scored by this engine, from
    // the initial abilities completePracticeSet re-derived from it a moment
    // ago — not the stored Diagnostic entry's midpoint, which for a student
    // who started before 2026.2 came from a different engine, and would make
    // a recalibration look like a gain or a loss.
    const baselinePoint = predictScore(initialAbilities).point;
    // The band comes from every answer the abilities were estimated from.
    const history = await loadAnswerHistory(tx, studentId);
    const computed = computeAdaptivePrediction(abilities, [...history.diagnostic, ...history.practice], baselinePoint);

    return tx.predictionHistoryEntry.create({
      data: {
        studentId,
        sourceType: "ADAPTIVE_SET",
        sourceSetId: practiceSetId,
        readingWritingAbility: computed.readingWritingAbility,
        mathAbility: computed.mathAbility,
        overallAbility: computed.overallAbility,
        internalDiagnosticEstimate: null,
        // From 2026.3 the display columns hold a score and its likely band:
        // representativeMidpoint is the predicted total, the range columns
        // its band. The fifteen-range index no longer applies.
        displayedRangeIndex: 0,
        displayedRangeMinimum: computed.low,
        displayedRangeMaximum: computed.high,
        representativeMidpoint: computed.point,
        approximateImprovement: computed.approximateImprovement,
        withinRangeProgress: progressWithinRange(computed.point, computed.low, computed.high),
        scoringEngineVersion: SCORING_ENGINE_VERSION,
      },
    });
  });
}
