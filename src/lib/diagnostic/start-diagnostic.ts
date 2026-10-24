import { prisma } from "@/lib/prisma";
import { createRandom, generateSeed } from "@/lib/adaptive/random";
import { logDiagnosticIncompleteCoverage } from "@/lib/logger";
import { selectDiagnosticQuestion } from "./question-selection";
import { DIAGNOSTIC_SEQUENCE, type SequenceSlot } from "./sequence";
import { convertLegacySession } from "./stages";

// PRD-012 §16 — "PrepHub does not provide a normal Retake"; a student has at
// most one DiagnosticSession, ever (DiagnosticSession.studentId is unique).
// Returning the existing session unchanged is both the resume path and the
// idempotent guard against double-generation.
export async function startOrResumeDiagnostic(studentId: string) {
  const existing = await prisma.diagnosticSession.findUnique({
    where: { studentId },
    include: { attempts: { orderBy: { position: "asc" } } },
  });
  if (existing) {
    // A session begun under the old fixed order is moved onto the staged one
    // the first time its student comes back, so the 73 students who quit on
    // the old opening return to the new one rather than the passage that
    // lost them. Idempotent, and a no-op for anything already STAGED.
    if (existing.format === "FULL_21" && existing.status === "IN_PROGRESS") {
      await convertLegacySession(existing.id);
      return prisma.diagnosticSession.findUniqueOrThrow({
        where: { studentId },
        include: { attempts: { orderBy: { position: "asc" } } },
      });
    }
    return existing;
  }

  const random = createRandom(generateSeed());
  const excludeQuestionIds = new Set<string>();
  // Designed, not shuffled: see sequence.ts for the order and why.
  const planned: readonly SequenceSlot[] = DIAGNOSTIC_SEQUENCE;

  const resolved: (SequenceSlot & { questionId: string; questionRevisionId: string })[] = [];
  const failures: string[] = [];
  for (const slot of planned) {
    const selected = await selectDiagnosticQuestion({
      category: slot.category,
      difficulty: slot.difficulty,
      excludeQuestionIds,
      random,
    });
    if (!selected) {
      failures.push(`${slot.category}/${slot.difficulty}`);
      continue;
    }
    excludeQuestionIds.add(selected.questionId);
    resolved.push({ ...slot, ...selected });
  }

  // Deliberate override of PRD-012 §10-§11's "hard failure on any missing
  // pool" — for a content bank that's still being built out (e.g. only one
  // category published so far), a diagnostic that only covers what's
  // actually available is more useful than refusing to generate anything at
  // all. Missing (category, difficulty) slots are simply skipped rather than
  // substituted with an adjacent difficulty; generate-diagnostic-prediction.ts
  // and complete-diagnostic.ts already treat a missing attempt as answered
  // incorrectly, so a partial diagnostic still produces a (conservative, but
  // well-defined) initial Ability Score and Predicted Score instead of
  // crashing on prediction generation.
  if (failures.length > 0) {
    logDiagnosticIncompleteCoverage("Diagnostic generated with incomplete question coverage", {
      accountId: studentId,
      missingPools: failures.join(", "),
    });
  }

  // §12 asks that the order "feel smooth and not visibly group by category".
  // This used to be met — on paper — by `shuffle(resolved, random)`, whose
  // result was discarded: `shuffle` returns a new array rather than shuffling
  // in place, so the order was the category-then-difficulty loop and every
  // student opened on three Reading passages. DIAGNOSTIC_SEQUENCE interleaves
  // categories by design instead, which meets §12 and controls the opening.
  //
  // Positions stay dense over whatever was resolved, so a content gap shifts
  // later slots up rather than leaving a hole. Nothing reads a position to
  // decide stage membership — that is by difficulty — so the shift is safe.
  return prisma.diagnosticSession.create({
    data: {
      studentId,
      status: "IN_PROGRESS",
      currentPosition: 0,
      // Written explicitly: the column defaults to FULL_21 so that sessions
      // created by older code during a deploy are labelled truthfully.
      format: "STAGED",
      attempts: {
        create: resolved.map((slot, position) => ({
          position,
          category: slot.category,
          difficulty: slot.difficulty,
          questionId: slot.questionId,
          questionRevisionId: slot.questionRevisionId,
        })),
      },
    },
    include: { attempts: { orderBy: { position: "asc" } } },
  });
}
