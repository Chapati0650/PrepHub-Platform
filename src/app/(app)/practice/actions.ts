"use server";

import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { finalizeAnswer } from "@/lib/adaptive/finalize-answer";
import { AdaptiveError } from "@/lib/adaptive/errors";
import { finalizePracticeSetCompletion } from "@/lib/adaptive/finalize-practice-set-completion";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { sanitizeDraftPatch, type DraftPatch } from "@/lib/session/draft";
import { logUnauthorizedAccess } from "@/lib/logger";
import { canOpenPracticeSet } from "@/lib/practice/free-tier";
import { sessionBlocked } from "@/lib/session/blocked";

async function requireStudentId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authorized.");
  if (!canUseStudentExperience(session.user.role)) {
    logUnauthorizedAccess("Non-student role attempted a practice action", {
      accountId: session.user.id,
      role: session.user.role,
    });
    throw new Error("Not authorized.");
  }
  return session.user.id;
}

async function requireOwnedSlot(studentId: string, slotId: string) {
  const slot = await prisma.blueprintSlot.findUnique({
    where: { id: slotId },
    include: { practiceSet: true, finalizedAttempt: true },
  });
  if (!slot) throw new Error("Question not found.");
  if (slot.practiceSet.studentId !== studentId) {
    // GER §2/§6: a student must only ever access their own resources —
    // this fires when the slot exists but belongs to a different student,
    // e.g. an id guessed or copied from another session.
    logUnauthorizedAccess("Student attempted to access another student's practice slot", {
      accountId: studentId,
      affectedResourceId: slotId,
    });
    throw new Error("Question not found.");
  }
  return slot;
}

// Premium ended partway through a set (a cancelled subscription reaching its
// period end, or a school's access ending). Returned as data so the runner
// can say so and offer the way back; a thrown error reaches the browser only
// as a generic failure. Everything already answered stays saved.
function premiumNeeded(setNumber: number) {
  return sessionBlocked(
    `Practice Set ${setNumber} is part of Premium, and your Premium access has ended. Every answer you submitted is saved.`,
    "/pricing",
    "Unlock with Premium",
  );
}

export async function loadPracticeQuestionAction(slotId: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  // The same gate the pages and the submit action apply: a locked set's
  // questions can't be read by slot id either.
  if (!(await canOpenPracticeSet(studentId, slot.practiceSet.setNumber))) return premiumNeeded(slot.practiceSet.setNumber);

  const content = await getStudentQuestionContent(slot.questionRevisionId);
  const feedback = slot.finalizedAttempt ? await getStudentQuestionFeedback(slot.questionRevisionId) : null;
  return { content, feedback };
}

export async function loadPracticeQuestionDetailAction(slotId: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  // A finished set stays reviewable after Premium ends: the student answered
  // every question in it while they had access, and this is their own work.
  // An unfinished locked set is gated like the runner.
  if (slot.practiceSet.status !== "COMPLETED" && !(await canOpenPracticeSet(studentId, slot.practiceSet.setNumber))) {
    throw new Error("This practice set needs Premium.");
  }

  const content = await getStudentQuestionContent(slot.questionRevisionId);
  // The answer key only once this question is answered or the session is
  // over: the review screen calls this, but so could a hand-made request for a
  // question still waiting to be answered.
  const reviewable = slot.finalizedAttempt !== null || slot.practiceSet.status === "COMPLETED";
  const feedback = reviewable ? await getStudentQuestionFeedback(slot.questionRevisionId) : null;
  return { content, feedback, studentAnswer: slot.finalizedAttempt?.answer ?? null };
}

export async function savePracticeDraftAction(slotId: string, patch: DraftPatch) {
  const studentId = await requireStudentId();
  await requireOwnedSlot(studentId, slotId);
  await prisma.blueprintSlot.updateMany({ where: { id: slotId, finalizedAttempt: null }, data: sanitizeDraftPatch(patch) });
}

export async function savePracticePositionAction(practiceSetId: string, position: number) {
  const studentId = await requireStudentId();
  const set = await prisma.practiceSet.findUnique({ where: { id: practiceSetId } });
  if (!set || set.studentId !== studentId) throw new Error("Practice set not found.");
  if (set.status === "COMPLETED") return;
  await prisma.practiceSet.update({ where: { id: practiceSetId }, data: { currentPosition: position } });
}

export async function submitPracticeAnswerAction(slotId: string, answer: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  // The gate the pages apply, applied to the write too: a hidden button is
  // not access control. Set 1 is free; later sets need Premium.
  if (!(await canOpenPracticeSet(studentId, slot.practiceSet.setNumber))) return premiumNeeded(slot.practiceSet.setNumber);
  const attempt = await finalizeAnswer({ studentId, blueprintSlotId: slotId, answer, isBlank: false });
  const feedback = await getStudentQuestionFeedback(slot.questionRevisionId);
  return { isCorrect: attempt.isCorrect, studentAnswer: attempt.answer!, feedback };
}

export async function completePracticeSetAction(
  practiceSetId: string,
): Promise<{ ok: true; redirectTo: string } | { ok: false; unansweredCount: number }> {
  const studentId = await requireStudentId();
  try {
    await finalizePracticeSetCompletion(studentId, practiceSetId);
    return { ok: true, redirectTo: `/practice/results/${practiceSetId}` };
  } catch (err) {
    if (err instanceof AdaptiveError && err.code === "BLANKS_REMAIN") {
      const set = await prisma.practiceSet.findUnique({
        where: { id: practiceSetId },
        include: { slots: { include: { finalizedAttempt: true } } },
      });
      const unansweredCount = set?.slots.filter((s) => !s.finalizedAttempt).length ?? 0;
      return { ok: false, unansweredCount };
    }
    throw err;
  }
}
