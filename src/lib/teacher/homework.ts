import { prisma } from "@/lib/prisma";
import { isAnswerCorrect } from "@/lib/adaptive/grading";
import { TeacherError } from "./errors";
import { normalizeJoinCode } from "./join-code";

/**
 * The student's side of classes and homework.
 *
 * Like the 800 Club, deliberately independent of src/lib/adaptive: homework
 * never reads or writes CategoryState, PracticeSet, FinalizedAttempt or
 * PredictionHistoryEntry. A teacher-chosen set of questions says nothing
 * reliable about ability, and a predicted score that moved because a teacher
 * assigned twenty easy questions would be a wrong number. It borrows the pure
 * answer grader and nothing that carries state.
 *
 * Homework is never behind the paywall: a teacher assigned it, and a class
 * where half the students can't open the homework isn't a class.
 */

export type JoinPreview = {
  classroomId: string;
  className: string;
  teacherFirstName: string;
  schoolName: string;
  alreadyIn: boolean;
};

export async function previewJoin(studentId: string, rawCode: string): Promise<JoinPreview | null> {
  const code = normalizeJoinCode(rawCode);
  if (!code) return null;
  const classroom = await prisma.classroom.findUnique({
    where: { joinCode: code },
    select: {
      id: true,
      name: true,
      archivedAt: true,
      teacher: { select: { firstName: true } },
      school: { select: { officialName: true } },
      enrollments: { where: { studentId, removedAt: null }, select: { id: true } },
    },
  });
  if (!classroom || classroom.archivedAt) return null;
  return {
    classroomId: classroom.id,
    className: classroom.name,
    teacherFirstName: classroom.teacher.firstName,
    schoolName: classroom.school.officialName,
    alreadyIn: classroom.enrollments.length > 0,
  };
}

/**
 * Joins a class by its code. Idempotent; a student a teacher removed can
 * rejoin with the code — the teacher sees them come back on the roster and
 * can change the code if that's not what they want.
 */
export async function joinClassroom(studentId: string, rawCode: string): Promise<{ classroomId: string }> {
  const code = normalizeJoinCode(rawCode);
  const classroom = code
    ? await prisma.classroom.findUnique({ where: { joinCode: code }, select: { id: true, archivedAt: true } })
    : null;
  if (!classroom) throw new TeacherError("CODE_NOT_FOUND", "No class has that code. Check it with your teacher.");
  if (classroom.archivedAt) throw new TeacherError("CLASS_CLOSED", "That class has been closed by its teacher.");

  await prisma.classroomEnrollment.upsert({
    where: { classroomId_studentId: { classroomId: classroom.id, studentId } },
    update: { removedAt: null },
    create: { classroomId: classroom.id, studentId },
  });
  return { classroomId: classroom.id };
}

export async function leaveClassroom(studentId: string, classroomId: string): Promise<void> {
  await prisma.classroomEnrollment.updateMany({
    where: { classroomId, studentId, removedAt: null },
    data: { removedAt: new Date() },
  });
}

export type StudentClass = { classroomId: string; name: string; teacherFirstName: string; schoolName: string };

export async function listStudentClasses(studentId: string): Promise<StudentClass[]> {
  const rows = await prisma.classroomEnrollment.findMany({
    where: { studentId, removedAt: null, classroom: { archivedAt: null } },
    orderBy: { joinedAt: "asc" },
    select: {
      classroom: {
        select: { id: true, name: true, teacher: { select: { firstName: true } }, school: { select: { officialName: true } } },
      },
    },
  });
  return rows.map((r) => ({
    classroomId: r.classroom.id,
    name: r.classroom.name,
    teacherFirstName: r.classroom.teacher.firstName,
    schoolName: r.classroom.school.officialName,
  }));
}

export type HomeworkItem = {
  assignmentId: string;
  title: string;
  instructions: string | null;
  className: string;
  teacherFirstName: string;
  dueAt: Date | null;
  questionCount: number;
  closed: boolean;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  sessionId: string | null;
  answered: number;
  correct: number;
  completedAt: Date | null;
};

/**
 * Every assignment in the student's open classes, split into what's still to
 * do (soonest due first, undated last) and what's done (most recent first).
 * A closed assignment the student never started drops out of "to do" — there
 * is nothing they can do about it — but anything they finished stays.
 */
export async function listHomework(studentId: string): Promise<{ todo: HomeworkItem[]; done: HomeworkItem[] }> {
  const assignments = await prisma.assignment.findMany({
    where: {
      classroom: { archivedAt: null, enrollments: { some: { studentId, removedAt: null } } },
    },
    select: {
      id: true,
      title: true,
      instructions: true,
      dueAt: true,
      closedAt: true,
      createdAt: true,
      classroom: { select: { name: true, teacher: { select: { firstName: true } } } },
      _count: { select: { questions: true } },
      sessions: {
        where: { studentId },
        select: {
          id: true,
          status: true,
          completedAt: true,
          slots: { select: { isCorrect: true, finalizedAt: true } },
        },
      },
    },
  });

  const items: HomeworkItem[] = assignments.map((a) => {
    const session = a.sessions[0] ?? null;
    const finalized = session?.slots.filter((s) => s.finalizedAt) ?? [];
    return {
      assignmentId: a.id,
      title: a.title,
      instructions: a.instructions,
      className: a.classroom.name,
      teacherFirstName: a.classroom.teacher.firstName,
      dueAt: a.dueAt,
      questionCount: a._count.questions,
      closed: a.closedAt !== null,
      status: !session ? "NOT_STARTED" : session.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS",
      sessionId: session?.id ?? null,
      answered: finalized.length,
      correct: finalized.filter((s) => s.isCorrect).length,
      completedAt: session?.completedAt ?? null,
    };
  });

  const todo = items
    .filter((i) => i.status !== "COMPLETED" && !i.closed)
    .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));
  const done = items
    .filter((i) => i.status === "COMPLETED")
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  return { todo, done };
}

/** The assignment as the student sees it before starting, or null if it isn't theirs. */
export async function getHomeworkForStudent(studentId: string, assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      title: true,
      instructions: true,
      dueAt: true,
      closedAt: true,
      classroom: {
        select: {
          name: true,
          archivedAt: true,
          teacher: { select: { firstName: true } },
          enrollments: { where: { studentId, removedAt: null }, select: { id: true } },
        },
      },
      _count: { select: { questions: true } },
      sessions: { where: { studentId }, select: { id: true, status: true } },
    },
  });
  if (!assignment) return null;
  const session = assignment.sessions[0] ?? null;
  // Someone no longer in the class can still see work they finished there.
  const inClass = assignment.classroom.enrollments.length > 0 && !assignment.classroom.archivedAt;
  if (!inClass && !session) return null;
  return {
    id: assignment.id,
    title: assignment.title,
    instructions: assignment.instructions,
    dueAt: assignment.dueAt,
    closed: assignment.closedAt !== null,
    className: assignment.classroom.name,
    teacherFirstName: assignment.classroom.teacher.firstName,
    questionCount: assignment._count.questions,
    inClass,
    session,
  };
}

/**
 * Starts the student's attempt, or returns the one they have. One per
 * student per assignment, enforced by the unique index: a double click opens
 * the same session rather than two.
 */
export async function startHomework(studentId: string, assignmentId: string): Promise<{ sessionId: string }> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      closedAt: true,
      classroom: { select: { archivedAt: true, enrollments: { where: { studentId, removedAt: null }, select: { id: true } } } },
      questions: { orderBy: { position: "asc" }, select: { position: true, questionId: true, questionRevisionId: true } },
      sessions: { where: { studentId }, select: { id: true } },
    },
  });
  if (!assignment) throw new TeacherError("NOT_FOUND", "Homework not found.");
  if (assignment.sessions[0]) return { sessionId: assignment.sessions[0].id };
  if (assignment.classroom.enrollments.length === 0 || assignment.classroom.archivedAt) {
    throw new TeacherError("NOT_IN_CLASS", "You're not in this class.");
  }
  if (assignment.closedAt) throw new TeacherError("ASSIGNMENT_CLOSED", "Your teacher has closed this homework.");
  if (assignment.questions.length === 0) throw new TeacherError("NOT_FOUND", "This homework has no questions.");

  try {
    const created = await prisma.homeworkSession.create({
      data: {
        assignmentId,
        studentId,
        slots: {
          create: assignment.questions.map((q) => ({
            position: q.position,
            questionId: q.questionId,
            questionRevisionId: q.questionRevisionId,
          })),
        },
      },
      select: { id: true },
    });
    return { sessionId: created.id };
  } catch (err) {
    // Lost a race with a second click: the other request's session is the one.
    const existing = await prisma.homeworkSession.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId } },
      select: { id: true },
    });
    if (existing) return { sessionId: existing.id };
    throw err;
  }
}

/**
 * Idempotent: a retried submit returns the first recorded answer rather than
 * grading again. The check and the write are one transaction.
 */
export async function finalizeHomeworkAnswer(params: { studentId: string; slotId: string; answer: string }) {
  return prisma.$transaction(async (tx) => {
    const slot = await tx.homeworkSlot.findUnique({
      where: { id: params.slotId },
      include: {
        session: { include: { assignment: { select: { closedAt: true } } } },
        question: true,
        questionRevision: { include: { answerChoices: true } },
      },
    });
    if (!slot || slot.session.studentId !== params.studentId) {
      throw new TeacherError("NOT_FOUND", "Question not found.");
    }
    if (slot.finalizedAt) return { isCorrect: slot.isCorrect ?? false, answer: slot.answer ?? "" };
    if (slot.session.status === "COMPLETED") throw new TeacherError("NOT_FOUND", "This homework is already finished.");
    if (slot.session.assignment.closedAt) throw new TeacherError("ASSIGNMENT_CLOSED", "Your teacher has closed this homework.");

    const isCorrect = isAnswerCorrect(slot.question.questionType, params.answer, slot.questionRevision);
    await tx.homeworkSlot.update({
      where: { id: slot.id },
      data: { answer: params.answer, isCorrect, finalizedAt: new Date(), draftAnswer: null, skipped: false },
    });
    return { isCorrect, answer: params.answer };
  });
}

/** Same rule as every other set (PRD-005 §21): finished means every question answered. */
export async function completeHomeworkSession(studentId: string, sessionId: string): Promise<void> {
  const session = await prisma.homeworkSession.findUnique({
    where: { id: sessionId },
    include: { slots: { select: { finalizedAt: true } } },
  });
  if (!session || session.studentId !== studentId) throw new TeacherError("NOT_FOUND", "Homework not found.");
  if (session.status === "COMPLETED") return;
  const unanswered = session.slots.filter((s) => !s.finalizedAt).length;
  if (unanswered > 0) {
    throw new TeacherError("BLANKS_REMAIN", `${unanswered} question${unanswered === 1 ? "" : "s"} remain unanswered.`, {
      unanswered,
    });
  }
  await prisma.homeworkSession.updateMany({
    where: { id: sessionId, status: "ACTIVE" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

export async function getHomeworkSessionForRunner(studentId: string, sessionId: string) {
  const session = await prisma.homeworkSession.findUnique({
    where: { id: sessionId },
    include: {
      slots: { orderBy: { position: "asc" } },
      assignment: { select: { id: true, title: true, closedAt: true, classroom: { select: { name: true } } } },
    },
  });
  if (!session || session.studentId !== studentId) return null;
  return session;
}

export type HomeworkResults = {
  sessionId: string;
  assignmentId: string;
  title: string;
  className: string;
  total: number;
  correct: number;
  completedAt: Date | null;
  dueAt: Date | null;
  questions: { slotId: string; position: number; isCorrect: boolean; category: string }[];
};

export async function getHomeworkResults(studentId: string, sessionId: string): Promise<HomeworkResults | null> {
  const session = await prisma.homeworkSession.findUnique({
    where: { id: sessionId },
    include: {
      slots: { orderBy: { position: "asc" }, include: { question: { select: { category: true } } } },
      assignment: { select: { id: true, title: true, dueAt: true, classroom: { select: { name: true } } } },
    },
  });
  if (!session || session.studentId !== studentId || session.status !== "COMPLETED") return null;
  return {
    sessionId: session.id,
    assignmentId: session.assignment.id,
    title: session.assignment.title,
    className: session.assignment.classroom.name,
    total: session.slots.length,
    correct: session.slots.filter((s) => s.isCorrect).length,
    completedAt: session.completedAt,
    dueAt: session.assignment.dueAt,
    questions: session.slots.map((s) => ({
      slotId: s.id,
      position: s.position,
      isCorrect: s.isCorrect ?? false,
      category: s.question.category,
    })),
  };
}
