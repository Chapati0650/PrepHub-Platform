import type { QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { initialAbilityFromDiagnostic } from "@/lib/adaptive/diagnostic-initialization";
import { generatePracticeSet } from "@/lib/adaptive/generate-practice-set";
import { generateDiagnosticPrediction } from "@/lib/score/generate-diagnostic-prediction";
import { logGenerationFailure } from "@/lib/logger";
import { DiagnosticError } from "./errors";

// PRD-012 §22 / PRD-014 §5 — completing the diagnostic creates all seven
// Category States before any adaptive set can be generated. Idempotent: a
// retried call after a partial failure sees status already COMPLETED and
// returns immediately without re-deriving Ability Scores a second time.
export async function completeDiagnostic(studentId: string) {
  const session = await prisma.diagnosticSession.findUnique({
    where: { studentId },
    include: { attempts: true },
  });
  if (!session) throw new DiagnosticError("SESSION_NOT_FOUND", "Diagnostic session not found.");
  if (session.status === "COMPLETED") return session;

  const unanswered = session.attempts.filter((a) => a.submittedAt === null);
  if (unanswered.length > 0) {
    throw new DiagnosticError("QUESTIONS_REMAIN", `${unanswered.length} question(s) remain unanswered.`);
  }

  const byCategory = new Map<QuestionCategory, typeof session.attempts>();
  for (const attempt of session.attempts) {
    const list = byCategory.get(attempt.category) ?? [];
    list.push(attempt);
    byCategory.set(attempt.category, list);
  }

  const categoryStatesData = ALL_CATEGORIES.map((category) => {
    const attempts = byCategory.get(category) ?? [];
    const easy = attempts.find((a) => a.difficulty === "EASY");
    const medium = attempts.find((a) => a.difficulty === "MEDIUM");
    const hard = attempts.find((a) => a.difficulty === "HARD");
    const ability = initialAbilityFromDiagnostic(!!easy?.isCorrect, !!medium?.isCorrect, !!hard?.isCorrect);
    return {
      studentId,
      category,
      ability,
      initialAbility: ability,
      adaptiveQuestionsAnswered: 0,
      consecutiveSetsWithoutExtraAllocation: 0,
    };
  });

  return prisma.$transaction(async (tx) => {
    await tx.categoryState.createMany({ data: categoryStatesData, skipDuplicates: true });
    return tx.diagnosticSession.update({ where: { id: session.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  });
}

// PRD-012 §22 — completion also produces the initial prediction and the
// next adaptive set. Practice-set generation is explicitly allowed to happen
// "in the background," so a failure there must not block diagnostic
// completion or the results screen — it can be regenerated lazily the first
// time the student opens Practice (generatePracticeSet is itself idempotent).
export async function finalizeDiagnosticCompletion(studentId: string) {
  const session = await completeDiagnostic(studentId);
  const prediction = await generateDiagnosticPrediction(studentId);

  try {
    await generatePracticeSet(studentId);
  } catch (err) {
    logGenerationFailure("Failed to pre-generate the next practice set after diagnostic completion", {
      accountId: studentId,
      errorType: err instanceof Error ? err.message : String(err),
    });
  }

  return { session, prediction };
}
