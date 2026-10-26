"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { sanitizeDraftPatch, type DraftPatch } from "@/lib/session/draft";
import { isClubSection } from "@/lib/club/config";
import { ClubError } from "@/lib/club/errors";
import { completeClubSession, finalizeClubAnswer, openClubSession } from "@/lib/club/sessions";
import { sessionBlocked } from "@/lib/session/blocked";

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

// Returned as data, not thrown, so the runner can tell the student why it
// stopped and where to go (see lib/session/blocked.ts). Premium can end
// partway through a session — a cancelled plan reaching its period end, a
// school's access ending — and a session can be finished in another tab.
const PREMIUM_NEEDED = sessionBlocked(
  "The 800 Club is part of Premium, and your Premium access has ended. Every answer you submitted is saved.",
  "/pricing",
  "Unlock with Premium",
);

function alreadyFinished(sessionId: string) {
  return sessionBlocked(
    "You've already finished this session, so this answer wasn't recorded.",
    `/800-club/results/${sessionId}`,
    "See your results",
  );
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
  if (!(await hasPaidAccess(studentId))) return PREMIUM_NEEDED;
  const content = await getStudentQuestionContent(slot.questionRevisionId);
  const feedback = slot.finalizedAt ? await getStudentQuestionFeedback(slot.questionRevisionId) : null;
  return { content, feedback };
}

export async function loadClubQuestionDetailAction(slotId: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  const content = await getStudentQuestionContent(slot.questionRevisionId);
  // The answer key only once this question is answered or the session is
  // over: the review screen calls this, but so could a hand-made request for a
  // question still waiting to be answered.
  const reviewable = slot.finalizedAt !== null || slot.session.status === "COMPLETED";
  const feedback = reviewable ? await getStudentQuestionFeedback(slot.questionRevisionId) : null;
  return { content, feedback, studentAnswer: slot.answer };
}

export async function saveClubDraftAction(slotId: string, patch: DraftPatch) {
  const studentId = await requireStudentId();
  await requireOwnedSlot(studentId, slotId);
  await prisma.clubSlot.updateMany({ where: { id: slotId, finalizedAt: null }, data: sanitizeDraftPatch(patch) });
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
  // The page checks Premium when the session opens; this checks it for every
  // answer, because a hidden button is not access control and access can end
  // while the session is open.
  if (!(await hasPaidAccess(studentId))) return PREMIUM_NEEDED;
  let result;
  try {
    result = await finalizeClubAnswer({ studentId, slotId, answer });
  } catch (err) {
    if (err instanceof ClubError && err.code === "SESSION_COMPLETED") return alreadyFinished(slot.sessionId);
    throw err;
  }
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
