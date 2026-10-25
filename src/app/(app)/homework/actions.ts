"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { TeacherError } from "@/lib/teacher/errors";
import {
  completeHomeworkSession,
  finalizeHomeworkAnswer,
  joinClassroom,
  leaveClassroom,
  startHomework,
} from "@/lib/teacher/homework";

/**
 * Homework is for student accounts. Not the Administrator's shared school
 * account (a class roster with "the school" on it would be meaningless), and
 * not a teacher's — they preview questions with the answer key instead.
 */
async function requireStudentId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "STUDENT") {
    logUnauthorizedAccess("Non-student attempted a homework action", { accountId: session.user.id, role: session.user.role });
    throw new Error("Not authorized.");
  }
  return session.user.id;
}

// GER §2: a student only ever touches their own slots; a guessed id is logged
// as a privilege-boundary attempt, the same shape as the 800 Club's guard.
async function requireOwnedSlot(studentId: string, slotId: string) {
  const slot = await prisma.homeworkSlot.findUnique({ where: { id: slotId }, include: { session: true } });
  if (!slot) throw new Error("Question not found.");
  if (slot.session.studentId !== studentId) {
    logUnauthorizedAccess("Student attempted to access another student's homework slot", {
      accountId: studentId,
      affectedResourceId: slotId,
    });
    throw new Error("Question not found.");
  }
  return slot;
}

export type JoinState = { error?: string };

export async function joinClassAction(_prev: JoinState, formData: FormData): Promise<JoinState> {
  const studentId = await requireStudentId();
  try {
    await joinClassroom(studentId, String(formData.get("code") ?? ""));
  } catch (err) {
    if (err instanceof TeacherError) return { error: err.message };
    throw err;
  }
  // The nav's Homework item depends on being in a class, so the layout re-renders.
  revalidatePath("/", "layout");
  redirect("/homework?joined=1");
}

export async function leaveClassAction(classroomId: string): Promise<void> {
  const studentId = await requireStudentId();
  await leaveClassroom(studentId, classroomId);
  revalidatePath("/", "layout");
}

export async function startHomeworkAction(formData: FormData): Promise<void> {
  const studentId = await requireStudentId();
  const assignmentId = String(formData.get("assignmentId") ?? "");
  let sessionId: string;
  try {
    sessionId = (await startHomework(studentId, assignmentId)).sessionId;
  } catch (err) {
    if (err instanceof TeacherError) redirect(`/homework/${assignmentId}?error=${err.code}`);
    throw err;
  }
  redirect(`/homework/session/${sessionId}`);
}

export async function loadHomeworkQuestionAction(slotId: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  const content = await getStudentQuestionContent(slot.questionRevisionId);
  const feedback = slot.finalizedAt ? await getStudentQuestionFeedback(slot.questionRevisionId) : null;
  return { content, feedback };
}

export async function loadHomeworkQuestionDetailAction(slotId: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  const [content, feedback] = await Promise.all([
    getStudentQuestionContent(slot.questionRevisionId),
    getStudentQuestionFeedback(slot.questionRevisionId),
  ]);
  return { content, feedback, studentAnswer: slot.answer };
}

export async function saveHomeworkDraftAction(slotId: string, patch: { draftAnswer?: string | null; skipped?: boolean }) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  if (slot.finalizedAt) return;
  await prisma.homeworkSlot.update({ where: { id: slotId }, data: patch });
}

export async function saveHomeworkPositionAction(sessionId: string, position: number) {
  const studentId = await requireStudentId();
  const session = await prisma.homeworkSession.findUnique({ where: { id: sessionId } });
  if (!session || session.studentId !== studentId) throw new Error("Homework not found.");
  if (session.status === "COMPLETED") return;
  await prisma.homeworkSession.update({ where: { id: sessionId }, data: { currentPosition: position } });
}

export async function submitHomeworkAnswerAction(slotId: string, answer: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  const result = await finalizeHomeworkAnswer({ studentId, slotId, answer });
  const feedback = await getStudentQuestionFeedback(slot.questionRevisionId);
  return { isCorrect: result.isCorrect, studentAnswer: result.answer, feedback };
}

export async function completeHomeworkSessionAction(
  sessionId: string,
): Promise<{ ok: true; redirectTo: string } | { ok: false; unansweredCount: number }> {
  const studentId = await requireStudentId();
  try {
    await completeHomeworkSession(studentId, sessionId);
    revalidatePath("/homework");
    return { ok: true, redirectTo: `/homework/results/${sessionId}` };
  } catch (err) {
    if (err instanceof TeacherError && err.code === "BLANKS_REMAIN") {
      return { ok: false, unansweredCount: err.details.unanswered ?? 0 };
    }
    throw err;
  }
}
