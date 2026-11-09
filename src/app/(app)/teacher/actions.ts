"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AssignmentMode, QuestionCategory, QuestionDifficulty, QuestionType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  requireOwnedAssignment,
  requireOwnedClassroom,
  requireTeacherAction,
  type TeacherContext,
} from "@/lib/teacher/access";
import {
  createClassroom,
  regenerateJoinCode,
  removeStudentFromClassroom,
  renameClassroom,
  setClassroomArchived,
  setTeacherDisplayName,
} from "@/lib/teacher/classrooms";
import {
  assignToMoreClasses,
  createAssignments,
  deleteAssignment,
  remindUnfinished,
  setAssignmentClosed,
  updateAssignment,
} from "@/lib/teacher/assignments";
import {
  assignedTitles,
  describeQuestions,
  getQuestionWithKey,
  pickRandomQuestions,
  publishedRevisionOf,
  searchQuestionBank,
  type BankFilters,
} from "@/lib/teacher/question-bank";
import { TeacherError } from "@/lib/teacher/errors";
import { endOfLocalDay } from "@/lib/community/goal";
import { CATEGORY_LABELS, DIFFICULTY_LABELS, QUESTION_TYPE_LABELS } from "@/lib/content/labels";
import { DEMO_LOCKED_MESSAGE, isDemoSession } from "@/lib/demo-guard";

export type TeacherActionState = { error?: string; success?: boolean };

function messageOf(err: unknown): string | null {
  return err instanceof TeacherError ? err.message : null;
}

// ---- Classes -------------------------------------------------------------------

export async function createClassroomAction(_prev: TeacherActionState, formData: FormData): Promise<TeacherActionState> {
  const context = await requireTeacherAction();
  let id: string;
  try {
    id = (await createClassroom(context, String(formData.get("name") ?? ""))).id;
  } catch (err) {
    const message = messageOf(err);
    if (message) return { error: message };
    throw err;
  }
  redirect(`/teacher/classes/${id}?new=1`);
}

export async function renameClassroomAction(_prev: TeacherActionState, formData: FormData): Promise<TeacherActionState> {
  const context = await requireTeacherAction();
  const classroomId = String(formData.get("classroomId") ?? "");
  try {
    await renameClassroom(context, classroomId, String(formData.get("name") ?? ""));
  } catch (err) {
    const message = messageOf(err);
    if (message) return { error: message };
    throw err;
  }
  revalidatePath(`/teacher/classes/${classroomId}`);
  return { success: true };
}

export async function regenerateJoinCodeAction(classroomId: string): Promise<{ error: string } | void> {
  const context = await requireTeacherAction();
  if (await isDemoSession()) return { error: DEMO_LOCKED_MESSAGE };
  await regenerateJoinCode(context, classroomId);
  revalidatePath(`/teacher/classes/${classroomId}`);
}

export async function setClassroomArchivedAction(classroomId: string, archived: boolean): Promise<{ error: string } | void> {
  const context = await requireTeacherAction();
  if (await isDemoSession()) return { error: DEMO_LOCKED_MESSAGE };
  await setClassroomArchived(context, classroomId, archived);
  revalidatePath(`/teacher/classes/${classroomId}`);
  revalidatePath("/teacher");
}

export async function removeStudentAction(classroomId: string, studentId: string): Promise<{ error: string } | void> {
  const context = await requireTeacherAction();
  if (await isDemoSession()) return { error: DEMO_LOCKED_MESSAGE };
  await removeStudentFromClassroom(context, classroomId, studentId);
  revalidatePath(`/teacher/classes/${classroomId}`);
}

export async function setTeacherDisplayNameAction(_prev: TeacherActionState, formData: FormData): Promise<TeacherActionState> {
  const context = await requireTeacherAction();
  try {
    await setTeacherDisplayName(context, String(formData.get("displayName") ?? ""));
  } catch (err) {
    const message = messageOf(err);
    if (message) return { error: message };
    throw err;
  }
  revalidatePath("/teacher", "layout");
  return { success: true };
}

// ---- The question bank -----------------------------------------------------------

const CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));
const DIFFICULTIES = new Set(Object.keys(DIFFICULTY_LABELS));
const TYPES = new Set(Object.keys(QUESTION_TYPE_LABELS));

/** Filters arrive from the client, so each is checked against the real enum. */
function cleanFilters(raw: BankFilters): BankFilters {
  return {
    category: raw.category && CATEGORIES.has(raw.category) ? (raw.category as QuestionCategory) : undefined,
    difficulty: raw.difficulty && DIFFICULTIES.has(raw.difficulty) ? (raw.difficulty as QuestionDifficulty) : undefined,
    questionType: raw.questionType && TYPES.has(raw.questionType) ? (raw.questionType as QuestionType) : undefined,
    search: raw.search?.slice(0, 120),
    hideAssigned: raw.hideAssigned === true,
  };
}

/**
 * The class the homework is being built for, checked to be this teacher's:
 * it decides which questions read "already assigned", so a guessed id must
 * not reveal another class's homework titles.
 */
async function builderClass(context: TeacherContext, classroomId: string): Promise<string> {
  return (await requireOwnedClassroom(context, classroomId)).id;
}

export async function searchQuestionBankAction(classroomId: string, filters: BankFilters, page: number) {
  const context = await requireTeacherAction();
  return searchQuestionBank(cleanFilters(filters), page, await builderClass(context, classroomId));
}

export async function pickRandomQuestionsAction(classroomId: string, filters: BankFilters, count: number, excludeIds: string[]) {
  const context = await requireTeacherAction();
  const classId = await builderClass(context, classroomId);
  const ids = await pickRandomQuestions(
    cleanFilters(filters),
    Math.min(Math.max(1, count), 30),
    excludeIds.slice(0, 60),
    classId,
  );
  const [summaries, assigned] = await Promise.all([describeQuestions(ids), assignedTitles(classId, ids)]);
  return summaries.map((s) => ({ ...s, assignedIn: assigned.get(s.id) ?? [] }));
}

/** A question from the bank with its answer key, for deciding whether to assign it. */
export async function previewBankQuestionAction(questionId: string) {
  await requireTeacherAction();
  return getQuestionWithKey(await publishedRevisionOf(questionId));
}

/** A question on an assignment, at the exact revision the class was given. */
export async function previewAssignedQuestionAction(assignmentId: string, position: number) {
  const context = await requireTeacherAction();
  await requireOwnedAssignment(context, assignmentId);
  const question = await prisma.assignmentQuestion.findUnique({
    where: { assignmentId_position: { assignmentId, position } },
    select: { questionRevisionId: true },
  });
  if (!question) throw new Error("Question not found.");
  return getQuestionWithKey(question.questionRevisionId);
}

// ---- Assignments ---------------------------------------------------------------

function dueFrom(raw: FormDataEntryValue | string | null | undefined): Date | null | "invalid" {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  return endOfLocalDay(value) ?? "invalid";
}

function modeFrom(raw: unknown): AssignmentMode {
  return raw === "QUIZ" ? "QUIZ" : "PRACTICE";
}

/**
 * Assigns the homework to the class it was built in and any of the
 * teacher's other classes ticked in the builder. Returns the builder's own
 * class's new assignment, which is where the teacher lands.
 */
export async function createAssignmentAction(
  classroomId: string,
  input: {
    title: string;
    instructions: string;
    dueOn: string;
    questionIds: string[];
    mode: string;
    alsoClassroomIds: string[];
  },
): Promise<{ error: string } | { ok: true; assignmentId: string; classCount: number }> {
  const context = await requireTeacherAction();
  const dueAt = dueFrom(input.dueOn);
  if (dueAt === "invalid") return { error: "Enter the due date as a date." };
  try {
    const created = await createAssignments(context, [classroomId, ...input.alsoClassroomIds.slice(0, 40)], {
      title: input.title,
      instructions: input.instructions,
      dueAt,
      mode: modeFrom(input.mode),
      questionIds: input.questionIds.slice(0, 60),
    });
    revalidatePath("/teacher", "layout");
    revalidatePath("/homework");
    const own = created.find((c) => c.classroomId === classroomId) ?? created[0];
    return { ok: true, assignmentId: own.id, classCount: created.length };
  } catch (err) {
    const message = messageOf(err);
    if (message) return { error: message };
    throw err;
  }
}

export async function updateAssignmentAction(_prev: TeacherActionState, formData: FormData): Promise<TeacherActionState> {
  const context = await requireTeacherAction();
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const dueAt = dueFrom(formData.get("dueOn"));
  if (dueAt === "invalid") return { error: "Enter the due date as a date." };
  try {
    await updateAssignment(context, assignmentId, {
      title: String(formData.get("title") ?? ""),
      instructions: String(formData.get("instructions") ?? ""),
      dueAt,
      mode: formData.has("mode") ? modeFrom(formData.get("mode")) : undefined,
    });
  } catch (err) {
    const message = messageOf(err);
    if (message) return { error: message };
    throw err;
  }
  revalidatePath("/teacher", "layout");
  revalidatePath("/homework");
  return { success: true };
}

/**
 * Copies this homework, at the revisions its class was given, to more of the
 * teacher's classes with a new due date. The teacher stays on the page they
 * started from; the result names each new copy so it can link to them.
 */
export async function assignToMoreClassesAction(
  assignmentId: string,
  input: { classroomIds: string[]; dueOn: string },
): Promise<{ error: string } | { ok: true; created: { classroomId: string; assignmentId: string }[] }> {
  const context = await requireTeacherAction();
  const dueAt = dueFrom(input.dueOn);
  if (dueAt === "invalid") return { error: "Enter the due date as a date." };
  // From the browser, so each id is checked to be a string before it reaches a query.
  const classroomIds = (Array.isArray(input.classroomIds) ? input.classroomIds : [])
    .filter((id): id is string => typeof id === "string")
    .slice(0, 40);
  try {
    const created = await assignToMoreClasses(context, assignmentId, classroomIds, { dueAt });
    revalidatePath("/teacher", "layout");
    revalidatePath("/homework");
    return { ok: true, created: created.map((c) => ({ classroomId: c.classroomId, assignmentId: c.id })) };
  } catch (err) {
    const message = messageOf(err);
    if (message) return { error: message };
    throw err;
  }
}

/** "Remind the N who haven't finished". Returned, not thrown, so the confirmation can say what went wrong. */
export async function remindUnfinishedAction(assignmentId: string): Promise<TeacherActionState & { sent?: number }> {
  const context = await requireTeacherAction();
  try {
    const { sent } = await remindUnfinished(context, assignmentId);
    revalidatePath("/teacher", "layout");
    return { success: true, sent };
  } catch (err) {
    const message = messageOf(err);
    if (message) return { error: message };
    throw err;
  }
}

export async function setAssignmentClosedAction(assignmentId: string, closed: boolean): Promise<void> {
  const context = await requireTeacherAction();
  await setAssignmentClosed(context, assignmentId, closed);
  revalidatePath("/teacher", "layout");
  revalidatePath("/homework");
}

export async function deleteAssignmentAction(assignmentId: string, classroomId: string): Promise<TeacherActionState> {
  const context = await requireTeacherAction();
  if (await isDemoSession()) return { error: DEMO_LOCKED_MESSAGE };
  try {
    await deleteAssignment(context, assignmentId);
  } catch (err) {
    const message = messageOf(err);
    if (message) return { error: message };
    throw err;
  }
  revalidatePath(`/teacher/classes/${classroomId}`);
  revalidatePath("/homework");
  redirect(`/teacher/classes/${classroomId}`);
}
