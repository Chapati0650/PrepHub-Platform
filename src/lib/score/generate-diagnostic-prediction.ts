import { prisma } from "@/lib/prisma";
import { initialAbilitiesFromDiagnostic } from "@/lib/adaptive/diagnostic-initialization";
import { computeDiagnosticPrediction } from "./compute-diagnostic-prediction";
import { diagnosticAnswers } from "@/lib/adaptive/estimate";
import { SCORING_ENGINE_VERSION, progressWithinRange } from "./config";
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

    // The same abilities complete-diagnostic.ts wrote to the Category States,
    // from the same answers. A question that was never served — a waived
    // bonus question, or a slot missing because the bank had no question for
    // it (start-diagnostic.ts) — is simply not evidence either way.
    const computed = computeDiagnosticPrediction(initialAbilitiesFromDiagnostic(session.attempts), diagnosticAnswers(session.attempts));

    return tx.predictionHistoryEntry.create({
      data: {
        studentId,
        sourceType: "DIAGNOSTIC",
        sourceSetId: null,
        // Section abilities, as on every Practice Set entry. Under 2026.1 a
        // Diagnostic entry kept 400-1600 pattern values in these two columns,
        // which is why sectionScoresForEntry reads the two versions apart.
        readingWritingAbility: computed.readingWritingAbility,
        mathAbility: computed.mathAbility,
        overallAbility: computed.overallAbility,
        internalDiagnosticEstimate: computed.totalScore,
        // From 2026.3 the display columns hold a score and its likely band
        // (see generate-adaptive-prediction.ts).
        displayedRangeIndex: 0,
        displayedRangeMinimum: computed.low,
        displayedRangeMaximum: computed.high,
        representativeMidpoint: computed.point,
        approximateImprovement: 0,
        withinRangeProgress: progressWithinRange(computed.point, computed.low, computed.high),
        scoringEngineVersion: SCORING_ENGINE_VERSION,
      },
    });
  });
}
