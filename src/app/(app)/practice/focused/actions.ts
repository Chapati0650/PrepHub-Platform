"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";
import {
  getStudentQuestionContent,
  getStudentQuestionFeedback,
} from "@/lib/session/question-content";
import { isFocusedDifficulty, isQuestionCategory } from "@/lib/focused/config";
import { FocusedError } from "@/lib/focused/errors";
import {
  completeFocusedSession,
  finalizeFocusedAnswer,
  openFocusedSession,
} from "@/lib/focused/sessions";

async function requireStudentId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authorized.");
  if (!canUseStudentExperience(session.user.role)) {
    logUnauthorizedAccess("Non-student role attempted a Focused Practice action", {
      accountId: session.user.id,
      role: session.user.role,
    });
    throw new Error("Not authorized.");
  }
  return session.user.id;
}

// GER §2: a student only ever touches their own slots. A guessed id from
// another student's session is logged as a privilege-boundary attempt rather
// than passed off as a 404.
async function requireOwnedSlot(studentId: string, slotId: string) {
  const slot = await prisma.focusedSlot.findUnique({
    where: { id: slotId },
    include: { session: true },
  });
  if (!slot) throw new Error("Question not found.");
  if (slot.session.studentId !== studentId) {
    logUnauthorizedAccess("Student attempted to access another student's Focused Practice slot", {
      accountId: studentId,
      affectedResourceId: slotId,
    });
    throw new Error("Question not found.");
  }
  return slot;
}

// "Start" on the picker. The paid-access check is here as well as on the
// page, because a disabled button is not access control.
export async function startFocusedSessionAction(formData: FormData): Promise<void> {
  const studentId = await requireStudentId();
  const category = formData.get("category");
  const difficulty = formData.get("difficulty");
  if (!isQuestionCategory(category)) throw new Error("Unknown category.");
  if (!isFocusedDifficulty(difficulty)) throw new Error("Unknown difficulty.");
  if (!(await hasPaidAccess(studentId))) redirect("/pricing");

  let sessionId: string;
  try {
    sessionId = (await openFocusedSession(studentId, category, difficulty)).id;
  } catch (err) {
    if (err instanceof FocusedError && err.code === "NO_QUESTIONS") {
      redirect(`/practice/focused?empty=${category}`);
    }
    throw err;
  }
  redirect(`/practice/focused/session/${sessionId}`);
}

export async function loadFocusedQuestionAction(slotId: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  const content = await getStudentQuestionContent(slot.questionRevisionId);
  const feedback = slot.finalizedAt
    ? await getStudentQuestionFeedback(slot.questionRevisionId)
    : null;
  return { content, feedback };
}

export async function loadFocusedQuestionDetailAction(slotId: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  const content = await getStudentQuestionContent(slot.questionRevisionId);
  const feedback = await getStudentQuestionFeedback(slot.questionRevisionId);
  return { content, feedback, studentAnswer: slot.answer };
}

export async function saveFocusedDraftAction(
  slotId: string,
  patch: { draftAnswer?: string | null; skipped?: boolean },
) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  if (slot.finalizedAt) return;
  await prisma.focusedSlot.update({ where: { id: slotId }, data: patch });
}

export async function saveFocusedPositionAction(sessionId: string, position: number) {
  const studentId = await requireStudentId();
  const session = await prisma.focusedSession.findUnique({ where: { id: sessionId } });
  if (!session || session.studentId !== studentId) throw new Error("Session not found.");
  if (session.status === "COMPLETED") return;
  await prisma.focusedSession.update({ where: { id: sessionId }, data: { currentPosition: position } });
}

export async function submitFocusedAnswerAction(slotId: string, answer: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  const result = await finalizeFocusedAnswer({ studentId, slotId, answer });
  const feedback = await getStudentQuestionFeedback(slot.questionRevisionId);
  return { isCorrect: result.isCorrect, studentAnswer: result.answer, feedback };
}

export async function completeFocusedSessionAction(
  sessionId: string,
): Promise<{ ok: true; redirectTo: string } | { ok: false; unansweredCount: number }> {
  const studentId = await requireStudentId();
  try {
    await completeFocusedSession(studentId, sessionId);
    return { ok: true, redirectTo: `/practice/focused/results/${sessionId}` };
  } catch (err) {
    if (err instanceof FocusedError && err.code === "BLANKS_REMAIN") {
      return { ok: false, unansweredCount: err.details.unanswered ?? 0 };
    }
    throw err;
  }
}
