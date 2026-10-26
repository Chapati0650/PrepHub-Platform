"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { sanitizeDraftPatch, type DraftPatch } from "@/lib/session/draft";
import { sessionBlocked, type SessionBlocked } from "@/lib/session/blocked";
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
  // The answer key only once this question is answered or the session is
  // over: the review screen calls this, but so could a hand-made request for a
  // question still waiting to be answered.
  const reviewable = slot.finalizedAt !== null || slot.session.status === "COMPLETED";
  const [content, feedback] = await Promise.all([
    getStudentQuestionContent(slot.questionRevisionId),
    reviewable ? getStudentQuestionFeedback(slot.questionRevisionId) : null,
  ]);
  return { content, feedback, studentAnswer: slot.answer };
}

export async function saveHomeworkDraftAction(slotId: string, patch: DraftPatch) {
  const studentId = await requireStudentId();
  await requireOwnedSlot(studentId, slotId);
  await prisma.homeworkSlot.updateMany({ where: { id: slotId, finalizedAt: null }, data: sanitizeDraftPatch(patch) });
}

export async function saveHomeworkPositionAction(sessionId: string, position: number) {
  const studentId = await requireStudentId();
  const session = await prisma.homeworkSession.findUnique({ where: { id: sessionId } });
  if (!session || session.studentId !== studentId) throw new Error("Homework not found.");
  if (session.status === "COMPLETED") return;
  await prisma.homeworkSession.update({ where: { id: sessionId }, data: { currentPosition: position } });
}

// The teacher closed the homework or the class, or took the student off the
// roster, while they were partway through. Returned rather than thrown: in
// production a thrown message never reaches the runner, which would just stop
// taking answers with nothing said (src/lib/session/blocked.ts).
function blockedBy(err: unknown): SessionBlocked | null {
  if (!(err instanceof TeacherError)) return null;
  if (err.code === "ASSIGNMENT_CLOSED") {
    const href = err.details.assignmentId ? `/homework/${err.details.assignmentId}` : "/homework";
    return sessionBlocked(err.message, href, "Back to this homework");
  }
  if (err.code === "NOT_IN_CLASS" || err.code === "CLASS_CLOSED") {
    return sessionBlocked(err.message, "/homework", "Back to Homework");
  }
  return null;
}

export async function submitHomeworkAnswerAction(slotId: string, answer: string) {
  const studentId = await requireStudentId();
  const slot = await requireOwnedSlot(studentId, slotId);
  let result;
  try {
    result = await finalizeHomeworkAnswer({ studentId, slotId, answer });
  } catch (err) {
    const blocked = blockedBy(err);
    if (blocked) return blocked;
    throw err;
  }
  const feedback = await getStudentQuestionFeedback(slot.questionRevisionId);
  return { isCorrect: result.isCorrect, studentAnswer: result.answer, feedback };
}

// The last answer has usually turned the homework in already
// (finalizeHomeworkAnswer), in which case this just goes to the results.
export async function completeHomeworkSessionAction(
  sessionId: string,
): Promise<{ ok: true; redirectTo: string } | { ok: false; unansweredCount: number } | SessionBlocked> {
  const studentId = await requireStudentId();
  try {
    await completeHomeworkSession(studentId, sessionId);
    revalidatePath("/homework");
    return { ok: true, redirectTo: `/homework/results/${sessionId}` };
  } catch (err) {
    if (err instanceof TeacherError && err.code === "BLANKS_REMAIN") {
      return { ok: false, unansweredCount: err.details.unanswered ?? 0 };
    }
    const blocked = blockedBy(err);
    if (blocked) return blocked;
    throw err;
  }
}
