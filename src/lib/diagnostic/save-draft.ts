import { prisma } from "@/lib/prisma";
import { DiagnosticError } from "./errors";
import { sanitizeDraftPatch, type DraftPatch } from "@/lib/session/draft";

// PRD-012 §16/§17 — unsubmitted selections and skip state must be preserved
// across pause/resume, but only until the answer is finalized (submitted
// answers are locked and must not be touched here).
export async function saveDiagnosticDraft(studentId: string, attemptId: string, patch: DraftPatch) {
  const attempt = await prisma.diagnosticAttempt.findUnique({
    where: { id: attemptId },
    include: { diagnosticSession: true },
  });
  if (!attempt || attempt.diagnosticSession.studentId !== studentId) {
    throw new DiagnosticError("ATTEMPT_NOT_FOUND", "Diagnostic question not found for this student.");
  }
  if (attempt.submittedAt) return attempt;

  // Conditioned on the row still being open, so a draft can't land on an
  // answer submitted a moment earlier; the patch is rebuilt from the two draft
  // fields (see sanitizeDraftPatch) because the action's argument is untrusted.
  await prisma.diagnosticAttempt.updateMany({
    where: { id: attemptId, submittedAt: null, waivedAt: null },
    data: sanitizeDraftPatch(patch),
  });
}

// PRD-012 §16 — "the system automatically saves current question position."
export async function saveDiagnosticPosition(studentId: string, position: number) {
  const session = await prisma.diagnosticSession.findUnique({ where: { studentId } });
  if (!session) throw new DiagnosticError("SESSION_NOT_FOUND", "Diagnostic session not found.");
  if (session.status === "COMPLETED") return session;
  return prisma.diagnosticSession.update({ where: { studentId }, data: { currentPosition: position } });
}
