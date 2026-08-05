"use server";

import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { startOrResumeDiagnostic } from "@/lib/diagnostic/start-diagnostic";
import { finalizeDiagnosticAttempt } from "@/lib/diagnostic/finalize-attempt";
import { saveDiagnosticDraft, saveDiagnosticPosition } from "@/lib/diagnostic/save-draft";
import { finalizeDiagnosticCompletion } from "@/lib/diagnostic/complete-diagnostic";
import { DiagnosticError } from "@/lib/diagnostic/errors";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";

async function requireStudentId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authorized.");
  if (!canUseStudentExperience(session.user.role)) {
    logUnauthorizedAccess("Non-student role attempted a diagnostic action", {
      accountId: session.user.id,
      role: session.user.role,
    });
    throw new Error("Not authorized.");
  }
  return session.user.id;
}

function requireOwnedAttempt<T extends { diagnosticSession: { studentId: string } }>(
  studentId: string,
  attemptId: string,
  attempt: T | null,
): asserts attempt is T {
  if (!attempt) throw new Error("Question not found.");
  if (attempt.diagnosticSession.studentId !== studentId) {
    logUnauthorizedAccess("Student attempted to access another student's diagnostic attempt", {
      accountId: studentId,
      affectedResourceId: attemptId,
    });
    throw new Error("Question not found.");
  }
}

export async function beginDiagnosticAction() {
  const studentId = await requireStudentId();
  await startOrResumeDiagnostic(studentId);
}

export async function loadDiagnosticQuestionAction(attemptId: string) {
  const studentId = await requireStudentId();
  const attempt = await prisma.diagnosticAttempt.findUnique({
    where: { id: attemptId },
    include: { diagnosticSession: true },
  });
  requireOwnedAttempt(studentId, attemptId, attempt);

  const content = await getStudentQuestionContent(attempt.questionRevisionId);
  const feedback = attempt.submittedAt ? await getStudentQuestionFeedback(attempt.questionRevisionId) : null;
  return { content, feedback };
}

export async function saveDiagnosticDraftAction(attemptId: string, patch: { draftAnswer?: string | null; skipped?: boolean }) {
  const studentId = await requireStudentId();
  await saveDiagnosticDraft(studentId, attemptId, patch);
}

export async function saveDiagnosticPositionAction(position: number) {
  const studentId = await requireStudentId();
  await saveDiagnosticPosition(studentId, position);
}

export async function submitDiagnosticAnswerAction(attemptId: string, answer: string) {
  const studentId = await requireStudentId();
  const attempt = await finalizeDiagnosticAttempt(studentId, attemptId, answer);
  const feedback = await getStudentQuestionFeedback(attempt.questionRevisionId);
  return { isCorrect: attempt.isCorrect!, studentAnswer: attempt.answer!, feedback };
}

export async function loadDiagnosticQuestionDetailAction(attemptId: string) {
  const studentId = await requireStudentId();
  const attempt = await prisma.diagnosticAttempt.findUnique({
    where: { id: attemptId },
    include: { diagnosticSession: true },
  });
  requireOwnedAttempt(studentId, attemptId, attempt);

  const content = await getStudentQuestionContent(attempt.questionRevisionId);
  const feedback = await getStudentQuestionFeedback(attempt.questionRevisionId);
  return { content, feedback };
}

export async function completeDiagnosticAction(): Promise<
  { ok: true; redirectTo: string } | { ok: false; unansweredCount: number }
> {
  const studentId = await requireStudentId();
  try {
    await finalizeDiagnosticCompletion(studentId);
    return { ok: true, redirectTo: "/diagnostic/results" };
  } catch (err) {
    if (err instanceof DiagnosticError && err.code === "QUESTIONS_REMAIN") {
      const session = await prisma.diagnosticSession.findUnique({
        where: { studentId },
        include: { attempts: true },
      });
      const unansweredCount = session?.attempts.filter((a) => a.submittedAt === null).length ?? 0;
      return { ok: false, unansweredCount };
    }
    throw err;
  }
}
