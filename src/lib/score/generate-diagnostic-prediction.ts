import type { QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { computeDiagnosticPrediction, type DiagnosticCategoryResult } from "./compute-diagnostic-prediction";
import { SCORING_ENGINE_VERSION } from "./config";
import { ScoreError } from "./errors";

// PRD-016 §3.1 / §13.1 — generates the student's one immutable initial
// prediction immediately after diagnostic completion. Idempotent: a diagnostic
// only ever happens once per student (DiagnosticSession.studentId is unique),
// but a retried call after a partial failure must not create a second entry.
export async function generateDiagnosticPrediction(studentId: string) {
  const existing = await prisma.predictionHistoryEntry.findFirst({
    where: { studentId, sourceType: "DIAGNOSTIC" },
  });
  if (existing) return existing;

  const session = await prisma.diagnosticSession.findUnique({
    where: { studentId },
    include: { attempts: true },
  });
  if (!session || session.status !== "COMPLETED") {
    throw new ScoreError("DIAGNOSTIC_INCOMPLETE", "Diagnostic must be completed before a prediction can be generated.");
  }

  const byCategory = new Map<QuestionCategory, typeof session.attempts>();
  for (const attempt of session.attempts) {
    const list = byCategory.get(attempt.category) ?? [];
    list.push(attempt);
    byCategory.set(attempt.category, list);
  }

  // A (category, difficulty) slot can be entirely absent when the diagnostic
  // was generated with incomplete question coverage (see start-diagnostic.ts)
  // — treated the same as complete-diagnostic.ts's initial-Ability-Score
  // derivation: a missing result is scored as incorrect rather than blocking
  // prediction generation outright. This keeps the prediction well-defined
  // (if conservative) instead of a hard DIAGNOSTIC_INCOMPLETE failure for a
  // content bank that's still being built out.
  const results: Record<QuestionCategory, DiagnosticCategoryResult> = {} as Record<QuestionCategory, DiagnosticCategoryResult>;
  for (const category of ALL_CATEGORIES) {
    const attempts = byCategory.get(category) ?? [];
    const easy = attempts.find((a) => a.difficulty === "EASY");
    const medium = attempts.find((a) => a.difficulty === "MEDIUM");
    const hard = attempts.find((a) => a.difficulty === "HARD");
    results[category] = { easyCorrect: !!easy?.isCorrect, mediumCorrect: !!medium?.isCorrect, hardCorrect: !!hard?.isCorrect };
  }

  const computed = computeDiagnosticPrediction(results);

  return prisma.predictionHistoryEntry.create({
    data: {
      studentId,
      sourceType: "DIAGNOSTIC",
      sourceSetId: null,
      readingWritingAbility: computed.readingWritingValue,
      mathAbility: computed.mathValue,
      overallAbility: computed.diagnosticEstimate,
      internalDiagnosticEstimate: computed.diagnosticEstimate,
      displayedRangeIndex: computed.range.index,
      displayedRangeMinimum: computed.range.scoreMin,
      displayedRangeMaximum: computed.range.scoreMax,
      representativeMidpoint: computed.range.midpoint,
      approximateImprovement: 0,
      withinRangeProgress: computed.withinRangeProgress,
      scoringEngineVersion: SCORING_ENGINE_VERSION,
    },
  });
}
