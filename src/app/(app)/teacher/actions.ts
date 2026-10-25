"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { QuestionCategory, QuestionDifficulty, QuestionType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOwnedAssignment, requireTeacherAction } from "@/lib/teacher/access";
import {
  createClassroom,
  regenerateJoinCode,
  removeStudentFromClassroom,
  renameClassroom,
  setClassroomArchived,
} from "@/lib/teacher/classrooms";
import { createAssignment, deleteAssignment, setAssignmentClosed, updateAssignment } from "@/lib/teacher/assignments";
import {
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
  redirect(`/teacher/classes/${id}`);
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

export async function regenerateJoinCodeAction(classroomId: string): Promise<void> {
  const context = await requireTeacherAction();
  await regenerateJoinCode(context, classroomId);
  revalidatePath(`/teacher/classes/${classroomId}`);
}

export async function setClassroomArchivedAction(classroomId: string, archived: boolean): Promise<void> {
  const context = await requireTeacherAction();
  await setClassroomArchived(context, classroomId, archived);
  revalidatePath(`/teacher/classes/${classroomId}`);
  revalidatePath("/teacher");
}

export async function removeStudentAction(classroomId: string, studentId: string): Promise<void> {
  const context = await requireTeacherAction();
  await removeStudentFromClassroom(context, classroomId, studentId);
  revalidatePath(`/teacher/classes/${classroomId}`);
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
  };
}

export async function searchQuestionBankAction(filters: BankFilters, page: number) {
  await requireTeacherAction();
  return searchQuestionBank(cleanFilters(filters), page);
}

export async function pickRandomQuestionsAction(filters: BankFilters, count: number, excludeIds: string[]) {
  await requireTeacherAction();
  const ids = await pickRandomQuestions(cleanFilters(filters), Math.min(Math.max(1, count), 30), excludeIds.slice(0, 60));
  return describeQuestions(ids);
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

export async function createAssignmentAction(
  classroomId: string,
  input: { title: string; instructions: string; dueOn: string; questionIds: string[] },
): Promise<{ error: string } | { ok: true; assignmentId: string }> {
  const context = await requireTeacherAction();
  const dueAt = dueFrom(input.dueOn);
  if (dueAt === "invalid") return { error: "Enter the due date as a date." };
  try {
    const { id } = await createAssignment(context, classroomId, {
      title: input.title,
      instructions: input.instructions,
      dueAt,
      questionIds: input.questionIds.slice(0, 60),
    });
    revalidatePath(`/teacher/classes/${classroomId}`);
    revalidatePath("/homework");
    return { ok: true, assignmentId: id };
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

export async function setAssignmentClosedAction(assignmentId: string, closed: boolean): Promise<void> {
  const context = await requireTeacherAction();
  await setAssignmentClosed(context, assignmentId, closed);
  revalidatePath("/teacher", "layout");
  revalidatePath("/homework");
}

export async function deleteAssignmentAction(assignmentId: string, classroomId: string): Promise<TeacherActionState> {
  const context = await requireTeacherAction();
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
