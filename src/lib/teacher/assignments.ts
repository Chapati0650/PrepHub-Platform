import type { QuestionCategory, QuestionDifficulty, QuestionType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ASSIGNMENT_INSTRUCTIONS_MAX, ASSIGNMENT_MAX_QUESTIONS, ASSIGNMENT_TITLE_MAX } from "./config";
import { requireOwnedAssignment, requireOwnedClassroom, type TeacherContext } from "./access";
import { TeacherError } from "./errors";

export type AssignmentInput = {
  title: string;
  instructions: string | null;
  dueAt: Date | null;
};

function cleanInput(input: AssignmentInput, now: Date): AssignmentInput {
  const title = input.title.trim().replace(/\s+/g, " ");
  if (!title) throw new TeacherError("INVALID_INPUT", "Give the homework a title.");
  if (title.length > ASSIGNMENT_TITLE_MAX) {
    throw new TeacherError("INVALID_INPUT", `Keep the title under ${ASSIGNMENT_TITLE_MAX} characters.`);
  }
  const instructions = input.instructions?.trim() || null;
  if (instructions && instructions.length > ASSIGNMENT_INSTRUCTIONS_MAX) {
    throw new TeacherError("INVALID_INPUT", `Keep the instructions under ${ASSIGNMENT_INSTRUCTIONS_MAX} characters.`);
  }
  if (input.dueAt && input.dueAt.getTime() <= now.getTime()) {
    throw new TeacherError("INVALID_INPUT", "Pick a due date that hasn't passed yet.");
  }
  return { title, instructions, dueAt: input.dueAt };
}

/**
 * Assigns a fixed list of questions to a class. Each question is pinned to
 * the revision published right now, so the class works on exactly what the
 * teacher looked at even if the Owner edits it tomorrow.
 *
 * Only published questions can be assigned — the same pool every student
 * surface draws from — and the order given is the order students see.
 */
export async function createAssignment(
  context: TeacherContext,
  classroomId: string,
  input: AssignmentInput & { questionIds: string[] },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const classroom = await requireOwnedClassroom(context, classroomId);
  if (classroom.archivedAt) throw new TeacherError("CLASS_CLOSED", "This class is archived. Restore it to assign homework.");

  const clean = cleanInput(input, now);
  const questionIds = [...new Set(input.questionIds)];
  if (questionIds.length === 0) throw new TeacherError("INVALID_INPUT", "Add at least one question.");
  if (questionIds.length > ASSIGNMENT_MAX_QUESTIONS) {
    throw new TeacherError("INVALID_INPUT", `An assignment can have up to ${ASSIGNMENT_MAX_QUESTIONS} questions.`);
  }

  const questions = await prisma.question.findMany({
    where: { id: { in: questionIds }, status: "PUBLISHED", currentPublishedRevisionId: { not: null } },
    select: { id: true, currentPublishedRevisionId: true },
  });
  const revisionById = new Map(questions.map((q) => [q.id, q.currentPublishedRevisionId!]));
  const missing = questionIds.filter((id) => !revisionById.has(id));
  if (missing.length > 0) {
    throw new TeacherError(
      "INVALID_INPUT",
      `${missing.length === 1 ? "One question is" : `${missing.length} questions are`} no longer available — remove ${missing.length === 1 ? "it" : "them"} and try again.`,
    );
  }

  return prisma.assignment.create({
    data: {
      classroomId,
      title: clean.title,
      instructions: clean.instructions,
      dueAt: clean.dueAt,
      questions: {
        create: questionIds.map((questionId, position) => ({
          position,
          questionId,
          questionRevisionId: revisionById.get(questionId)!,
        })),
      },
    },
    select: { id: true },
  });
}

/** Title, instructions and due date. The questions themselves never change once assigned. */
export async function updateAssignment(context: TeacherContext, assignmentId: string, input: AssignmentInput, now: Date = new Date()) {
  const assignment = await requireOwnedAssignment(context, assignmentId);
  // A due date already in the past may stay as it is; only a *new* one has to
  // be in the future.
  const dueUnchanged = (assignment.dueAt?.getTime() ?? null) === (input.dueAt?.getTime() ?? null);
  const clean = cleanInput({ ...input, dueAt: dueUnchanged ? null : input.dueAt }, now);
  await prisma.assignment.update({
    where: { id: assignmentId },
    data: { title: clean.title, instructions: clean.instructions, dueAt: dueUnchanged ? assignment.dueAt : clean.dueAt },
  });
}

/** Closing stops new starts and new answers; reopening allows them again. Work already done stays. */
export async function setAssignmentClosed(context: TeacherContext, assignmentId: string, closed: boolean) {
  await requireOwnedAssignment(context, assignmentId);
  await prisma.assignment.update({ where: { id: assignmentId }, data: { closedAt: closed ? new Date() : null } });
}

/**
 * Deleting is only for homework nobody has started — a mistake caught early.
 * Once a student has done any of it, their work is a record and the
 * assignment can only be closed.
 */
export async function deleteAssignment(context: TeacherContext, assignmentId: string) {
  await requireOwnedAssignment(context, assignmentId);
  const started = await prisma.homeworkSession.count({ where: { assignmentId } });
  if (started > 0) {
    throw new TeacherError("HAS_WORK", "Students have started this one, so it can be closed but not deleted.");
  }
  await prisma.assignment.delete({ where: { id: assignmentId } });
}

export type SubmissionStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export type AssignmentResults = {
  id: string;
  title: string;
  instructions: string | null;
  dueAt: Date | null;
  closed: boolean;
  createdAt: Date;
  classroom: { id: string; name: string };
  questions: {
    position: number;
    questionId: string;
    category: QuestionCategory;
    difficulty: QuestionDifficulty;
    questionType: QuestionType;
    answered: number;
    correct: number;
  }[];
  students: {
    studentId: string;
    firstName: string;
    email: string;
    /** Still on the roster. A removed student's finished work stays listed. */
    enrolled: boolean;
    status: SubmissionStatus;
    answered: number;
    correct: number;
    completedAt: Date | null;
    late: boolean;
    /** Positions (0-based) this student got wrong, for the per-student breakdown. */
    missed: number[];
  }[];
  summary: { roster: number; completed: number; inProgress: number; notStarted: number; averagePercent: number | null };
};

/**
 * One assignment's results for its teacher: every student on the roster
 * (plus anyone removed after doing work), their status and score, and how
 * the class did on each question.
 *
 * This is the one place in PrepHub where an adult sees an individual
 * student's results, and it is deliberately only this: answers to the
 * questions this teacher assigned. No predicted score, no practice history,
 * nothing from anywhere else in the product — the line the join screen states
 * to the student before they join.
 */
export async function getAssignmentResults(context: TeacherContext, assignmentId: string): Promise<AssignmentResults> {
  const assignment = await requireOwnedAssignment(context, assignmentId);

  const [questions, enrollments, sessions] = await Promise.all([
    prisma.assignmentQuestion.findMany({
      where: { assignmentId },
      orderBy: { position: "asc" },
      select: { position: true, questionId: true, question: { select: { category: true, difficulty: true, questionType: true } } },
    }),
    prisma.classroomEnrollment.findMany({
      where: { classroomId: assignment.classroomId, removedAt: null },
      select: { student: { select: { id: true, firstName: true, email: true } } },
    }),
    prisma.homeworkSession.findMany({
      where: { assignmentId },
      select: {
        studentId: true,
        status: true,
        completedAt: true,
        student: { select: { firstName: true, email: true } },
        slots: { select: { position: true, isCorrect: true, finalizedAt: true } },
      },
    }),
  ]);

  const perQuestion = questions.map((q) => ({
    position: q.position,
    questionId: q.questionId,
    category: q.question.category,
    difficulty: q.question.difficulty,
    questionType: q.question.questionType,
    answered: 0,
    correct: 0,
  }));
  const byPosition = new Map(perQuestion.map((q) => [q.position, q]));

  const sessionByStudent = new Map(sessions.map((s) => [s.studentId, s]));
  for (const s of sessions) {
    for (const slot of s.slots) {
      if (!slot.finalizedAt) continue;
      const q = byPosition.get(slot.position);
      if (!q) continue;
      q.answered++;
      if (slot.isCorrect) q.correct++;
    }
  }

  const rosterIds = new Set(enrollments.map((e) => e.student.id));
  const people = [
    ...enrollments.map((e) => ({ studentId: e.student.id, firstName: e.student.firstName, email: e.student.email, enrolled: true })),
    // Removed after starting: their work happened, so it stays in the results.
    ...sessions
      .filter((s) => !rosterIds.has(s.studentId))
      .map((s) => ({ studentId: s.studentId, firstName: s.student.firstName, email: s.student.email, enrolled: false })),
  ];

  const students = people.map((p) => {
    const session = sessionByStudent.get(p.studentId);
    const finalized = session?.slots.filter((slot) => slot.finalizedAt) ?? [];
    const status: SubmissionStatus = !session ? "NOT_STARTED" : session.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS";
    return {
      ...p,
      status,
      answered: finalized.length,
      correct: finalized.filter((slot) => slot.isCorrect).length,
      completedAt: session?.completedAt ?? null,
      late: Boolean(assignment.dueAt && session?.completedAt && session.completedAt > assignment.dueAt),
      missed: finalized
        .filter((slot) => !slot.isCorrect)
        .map((slot) => slot.position)
        .sort((x, y) => x - y),
    };
  });

  // Finished first (best score first), then in progress, then not started —
  // the order a teacher scans for "who still owes me this".
  const rank: Record<SubmissionStatus, number> = { COMPLETED: 0, IN_PROGRESS: 1, NOT_STARTED: 2 };
  students.sort((a, b) => rank[a.status] - rank[b.status] || b.correct - a.correct || a.firstName.localeCompare(b.firstName));

  const total = questions.length;
  const completed = students.filter((s) => s.status === "COMPLETED");
  return {
    id: assignment.id,
    title: assignment.title,
    instructions: assignment.instructions,
    dueAt: assignment.dueAt,
    closed: assignment.closedAt !== null,
    createdAt: assignment.createdAt,
    classroom: { id: assignment.classroom.id, name: assignment.classroom.name },
    questions: perQuestion,
    students,
    summary: {
      roster: enrollments.length,
      completed: completed.length,
      inProgress: students.filter((s) => s.status === "IN_PROGRESS").length,
      notStarted: students.filter((s) => s.status === "NOT_STARTED" && s.enrolled).length,
      averagePercent:
        completed.length > 0 && total > 0
          ? Math.round((completed.reduce((sum, s) => sum + s.correct, 0) / (completed.length * total)) * 100)
          : null,
    },
  };
}
