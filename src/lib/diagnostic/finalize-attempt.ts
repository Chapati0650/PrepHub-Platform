import { prisma } from "@/lib/prisma";
import { isAnswerCorrect } from "@/lib/adaptive/grading";
import { DiagnosticError } from "./errors";

// PRD-012 §18 — "A question is evaluated only when the student deliberately
// submits... After submission the answer is final." No blank-confirmation
// path exists for the diagnostic (unlike PRD-014 adaptive sets) — §20
// requires every question to be genuinely answered before completion.
// Idempotent: a retried submit for an already-finalized attempt returns the
// existing result rather than re-grading (the update is conditioned on
// submittedAt still being null to close the race window).
export async function finalizeDiagnosticAttempt(studentId: string, attemptId: string, answer: string) {
  if (!answer || answer.trim() === "") {
    throw new DiagnosticError("ANSWER_REQUIRED", "An answer is required to submit a diagnostic question.");
  }

  const attempt = await prisma.diagnosticAttempt.findUnique({
    where: { id: attemptId },
    include: {
      diagnosticSession: true,
      question: true,
      questionRevision: { include: { answerChoices: true } },
    },
  });
  if (!attempt || attempt.diagnosticSession.studentId !== studentId) {
    throw new DiagnosticError("ATTEMPT_NOT_FOUND", "Diagnostic question not found for this student.");
  }
  if (attempt.diagnosticSession.status === "COMPLETED") {
    throw new DiagnosticError("ALREADY_COMPLETED", "The diagnostic has already been completed.");
  }
  if (attempt.submittedAt) return attempt;

  const isCorrect = isAnswerCorrect(attempt.question.questionType, answer, attempt.questionRevision);

  // Conditioning the update on submittedAt: null closes the race window — a
  // concurrent duplicate submit affects 0 rows and just re-reads the winner.
  await prisma.diagnosticAttempt.updateMany({
    where: { id: attemptId, submittedAt: null },
    data: { answer, isBlank: false, isCorrect, submittedAt: new Date(), draftAnswer: null, skipped: false },
  });
  return prisma.diagnosticAttempt.findUniqueOrThrow({ where: { id: attemptId } });
}
