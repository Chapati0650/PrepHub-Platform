"use server";

import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { startOrResumeDiagnostic } from "@/lib/diagnostic/start-diagnostic";
import { finalizeDiagnosticAttempt } from "@/lib/diagnostic/finalize-attempt";
import { saveDiagnosticDraft, saveDiagnosticPosition } from "@/lib/diagnostic/save-draft";
import { finalizeDiagnosticCompletion } from "@/lib/diagnostic/complete-diagnostic";
import { DiagnosticError } from "@/lib/diagnostic/errors";
import { advanceDiagnostic } from "@/lib/diagnostic/stages";
import { unansweredAttempts } from "@/lib/diagnostic/sequence";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import type { DraftPatch } from "@/lib/session/draft";
import { sessionBlocked } from "@/lib/session/blocked";
import { prisma } from "@/lib/prisma";
import { FUNNEL_EVENTS, track } from "@/lib/analytics/track";
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

// The Diagnostic was finished somewhere else — another tab, or a phone —
// while this runner was still open. Said plainly, with the way to the
// results, rather than as a failure the student would retry forever.
const DIAGNOSTIC_ALREADY_FINISHED = sessionBlocked(
  "You've already finished the Diagnostic, so this answer wasn't recorded. Your results are ready.",
  "/diagnostic/results",
  "See your results",
);

export async function beginDiagnosticAction() {
  const studentId = await requireStudentId();
  await startOrResumeDiagnostic(studentId);
  void track(FUNNEL_EVENTS.DIAGNOSTIC_STARTED, { userId: studentId });
}

export async function loadDiagnosticQuestionAction(attemptId: string) {
  const studentId = await requireStudentId();
  const attempt = await prisma.diagnosticAttempt.findUnique({
    where: { id: attemptId },
    include: { diagnosticSession: true },
  });
  requireOwnedAttempt(studentId, attemptId, attempt);
  // A waived bonus question was never shown, and no list the runner gets
  // contains one; only a hand-made request could ask for it.
  if (attempt.waivedAt) throw new Error("Question not found.");

  const content = await getStudentQuestionContent(attempt.questionRevisionId);
  const feedback = attempt.submittedAt ? await getStudentQuestionFeedback(attempt.questionRevisionId) : null;
  return { content, feedback };
}

export async function saveDiagnosticDraftAction(attemptId: string, patch: DraftPatch) {
  const studentId = await requireStudentId();
  await saveDiagnosticDraft(studentId, attemptId, patch);
}

export async function saveDiagnosticPositionAction(position: number) {
  const studentId = await requireStudentId();
  await saveDiagnosticPosition(studentId, position);
}

export async function submitDiagnosticAnswerAction(attemptId: string, answer: string) {
  const studentId = await requireStudentId();
  let attempt;
  try {
    attempt = await finalizeDiagnosticAttempt(studentId, attemptId, answer);
  } catch (err) {
    if (err instanceof DiagnosticError && err.code === "ALREADY_COMPLETED") return DIAGNOSTIC_ALREADY_FINISHED;
    throw err;
  }
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
  // The review lists only the questions the student was shown; a waived one
  // was never served, so there is nothing of theirs to review.
  if (attempt.waivedAt) throw new Error("Question not found.");

  const content = await getStudentQuestionContent(attempt.questionRevisionId);
  // The results page's review is the only caller, so the key waits for the
  // finished Diagnostic. Before then a hand-made request could read the answers
  // to questions still ahead, including the bonus round's.
  const feedback =
    attempt.diagnosticSession.status === "COMPLETED" ? await getStudentQuestionFeedback(attempt.questionRevisionId) : null;
  return { content, feedback, studentAnswer: attempt.answer };
}

/**
 * "Continue" at the end of the core, or "See my results" at the end of the
 * bonus round. The server decides which way it goes; see advanceDiagnostic.
 *
 * The bonus round is reached through `/diagnostic?round=unlocked` rather than
 * plain `/diagnostic` so the navigation is to a URL the student isn't already
 * on, which guarantees the page renders afresh with the new stage.
 */
export async function completeDiagnosticAction(): Promise<
  { ok: true; redirectTo: string } | { ok: false; unansweredCount: number }
> {
  const studentId = await requireStudentId();
  // Already finished in another tab: "See my results" goes straight to them.
  // Running completion again would only repeat its side effects (the funnel
  // event among them) for a Diagnostic that has nothing left to complete.
  const existing = await prisma.diagnosticSession.findUnique({ where: { studentId }, select: { status: true } });
  if (existing?.status === "COMPLETED") return { ok: true, redirectTo: "/diagnostic/results" };

  const step = await advanceDiagnostic(studentId);
  if (step.kind === "CORE_INCOMPLETE") return { ok: false, unansweredCount: step.unanswered };
  if (step.kind === "BONUS") return { ok: true, redirectTo: "/diagnostic?round=unlocked" };

  try {
    await finalizeDiagnosticCompletion(studentId);
    return { ok: true, redirectTo: "/diagnostic/results" };
  } catch (err) {
    if (err instanceof DiagnosticError && err.code === "QUESTIONS_REMAIN") {
      const session = await prisma.diagnosticSession.findUnique({
        where: { studentId },
        include: { attempts: true },
      });
      const unansweredCount = session ? unansweredAttempts(session.attempts).length : 0;
      return { ok: false, unansweredCount };
    }
    throw err;
  }
}
