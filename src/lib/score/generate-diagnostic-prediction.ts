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
//
// Also called by the results page, which generates the prediction there if
// completion committed and this step then failed — otherwise that student's
// results page would fail on every visit with nothing ever retrying it.
export async function generateDiagnosticPrediction(studentId: string) {
  // The fast path, and the one every results-page visit takes.
  const existing = await prisma.predictionHistoryEntry.findFirst({
    where: { studentId, sourceType: "DIAGNOSTIC" },
  });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    // Two calls can both miss the check above — a completion retried while
    // the results page is generating the same prediction — and under READ
    // COMMITTED both would then write one. Locking the student's Diagnostic
    // row makes the second wait until the first commits, and its re-check
    // below then finds that entry. (A partial unique index would also do it,
    // but needs a migration.)
    await tx.$queryRaw`SELECT "id" FROM "diagnostic_sessions" WHERE "studentId" = ${studentId} FOR UPDATE`;
    const written = await tx.predictionHistoryEntry.findFirst({
      where: { studentId, sourceType: "DIAGNOSTIC" },
    });
    if (written) return written;

    const session = await tx.diagnosticSession.findUnique({
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

    return tx.predictionHistoryEntry.create({
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
  });
}
