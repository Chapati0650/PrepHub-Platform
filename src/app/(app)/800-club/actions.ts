"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { isClubSection } from "@/lib/club/config";
import { ClubError } from "@/lib/club/errors";
import { completeClubSession, finalizeClubAnswer, openClubSession } from "@/lib/club/sessions";

async function requireStudentId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authorized.");
  if (!canUseStudentExperience(session.user.role)) {
    logUnauthorizedAccess("Non-student role attempted an 800 Club action", { accountId: session.user.id, role: session.user.role });
    throw new Error("Not authorized.");
  }
  return session.user.id;
}

// GER §2: a student only ever touches their own slots. Same shape as the
// practice actions' requireOwnedSlot; a guessed id from another student's
// session is logged as a privilege-boundary attempt, not a 404 in passing.
async function requireOwnedSlot(studentId: string, slotId: string) {
  const slot = await prisma.clubSlot.findUnique({ where: { id: slotId }, include: { session: true } });
  if (!slot) throw new Error("Question not found.");
  if (slot.session.studentId !== studentId) {
    logUnauthorizedAccess("Student attempted to access another student's 800 Club slot", {
      accountId: studentId,
      affectedResourceId: slotId,
    });
    throw new Error("Question not found.");
  }
  return slot;
}

// "Open" on the overview page. The paid-access check is here as well as on
// the page, because a button being hidden is not access control.
export async function openClubSectionAction(formData: FormData): Promise<void> {
  const studentId = await requireStudentId();
  const section = formData.get("section");
  if (!isClubSection(section)) throw new Error("Unknown section.");
  if (!(await hasPaidAccess(studentId))) redirect("/pricing");

  let sessionId: string;
  try {
    sessionId = (await openClubSession(studentId, section)).id;
  } catch (err) {
    if (err instanceof ClubError && err.code === "NO_QUESTIONS") redirect("/800-club?empty=1");
    throw err;
  }
  redirect(`/800-club/session/${sessionId}`);
}

export async function loadClubQuestionAction(slotId: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  const content = await getStudentQuestionContent(slot.questionRevisionId);
  const feedback = slot.finalizedAt ? await getStudentQuestionFeedback(slot.questionRevisionId) : null;
  return { content, feedback };
}

export async function loadClubQuestionDetailAction(slotId: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  const content = await getStudentQuestionContent(slot.questionRevisionId);
  const feedback = await getStudentQuestionFeedback(slot.questionRevisionId);
  return { content, feedback, studentAnswer: slot.answer };
}

export async function saveClubDraftAction(slotId: string, patch: { draftAnswer?: string | null; skipped?: boolean }) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  if (slot.finalizedAt) return;
  await prisma.clubSlot.update({ where: { id: slotId }, data: patch });
}

export async function saveClubPositionAction(sessionId: string, position: number) {
  const studentId = await requireStudentId();
  const session = await prisma.clubSession.findUnique({ where: { id: sessionId } });
  if (!session || session.studentId !== studentId) throw new Error("Session not found.");
  if (session.status === "COMPLETED") return;
  await prisma.clubSession.update({ where: { id: sessionId }, data: { currentPosition: position } });
}

export async function submitClubAnswerAction(slotId: string, answer: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  const result = await finalizeClubAnswer({ studentId, slotId, answer });
  const feedback = await getStudentQuestionFeedback(slot.questionRevisionId);
  return { isCorrect: result.isCorrect, studentAnswer: result.answer, feedback };
}

export async function completeClubSessionAction(
  sessionId: string,
): Promise<{ ok: true; redirectTo: string } | { ok: false; unansweredCount: number }> {
  const studentId = await requireStudentId();
  try {
    await completeClubSession(studentId, sessionId);
    return { ok: true, redirectTo: `/800-club/results/${sessionId}` };
  } catch (err) {
    if (err instanceof ClubError && err.code === "BLANKS_REMAIN") {
      return { ok: false, unansweredCount: err.details.unanswered ?? 0 };
    }
    throw err;
  }
}
