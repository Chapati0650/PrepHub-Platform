import { prisma } from "@/lib/prisma";
import { isAnswerCorrect } from "@/lib/adaptive/grading";
import { TeacherError } from "./errors";
import { joinedAfterDeadline, turnedInLate } from "./deadline";
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
  /** Already due (or closed) when this student joined the class — never shown to them as overdue. */
  setBeforeJoining: boolean;
  /** Every question answered but never turned in — from before the last answer turned homework in by itself. */
  readyToTurnIn: boolean;
};

/**
 * Every assignment in the student's open classes, split into what's still to
 * do (soonest due first, undated last), what's done (most recent first), and
 * homework that was already due before the student joined (`earlier`, most
 * recent first) — there if they want the practice, never counted against
 * them, and so kept out of "to do" and never shown in red.
 *
 * A closed assignment the student never finished drops out — there is nothing
 * they can do about it — unless every question is already answered, in which
 * case it can still be turned in. Anything they finished stays.
 */
export async function listHomework(
  studentId: string,
): Promise<{ todo: HomeworkItem[]; done: HomeworkItem[]; earlier: HomeworkItem[] }> {
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
      classroom: {
        select: {
          name: true,
          teacher: { select: { firstName: true } },
          enrollments: { where: { studentId, removedAt: null }, select: { joinedAt: true } },
        },
      },
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
    const status = !session ? "NOT_STARTED" : session.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS";
    const joinedAt = a.classroom.enrollments[0]?.joinedAt;
    return {
      assignmentId: a.id,
      title: a.title,
      instructions: a.instructions,
      className: a.classroom.name,
      teacherFirstName: a.classroom.teacher.firstName,
      dueAt: a.dueAt,
      questionCount: a._count.questions,
      closed: a.closedAt !== null,
      status,
      sessionId: session?.id ?? null,
      answered: finalized.length,
      correct: finalized.filter((s) => s.isCorrect).length,
      completedAt: session?.completedAt ?? null,
      setBeforeJoining: joinedAt ? joinedAfterDeadline(joinedAt, a) : false,
      readyToTurnIn:
        session !== null &&
        session.status !== "COMPLETED" &&
        session.slots.length > 0 &&
        finalized.length === session.slots.length,
    };
  });

  const open = items.filter((i) => i.status !== "COMPLETED" && (!i.closed || i.readyToTurnIn));
  const todo = open
    .filter((i) => !(i.setBeforeJoining && i.status === "NOT_STARTED"))
    .sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));
  const earlier = open
    .filter((i) => i.setBeforeJoining && i.status === "NOT_STARTED")
    .sort((a, b) => (b.dueAt?.getTime() ?? 0) - (a.dueAt?.getTime() ?? 0));
  const done = items
    .filter((i) => i.status === "COMPLETED")
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  return { todo, done, earlier };
}

/**
 * Why a student can't add answers to homework, or null if they can: taken off
 * the roster (or left), the class archived, or the homework closed. One
 * function, used by the answer and turn-in writes and by the runner's page, so
 * the three can't disagree. Most specific first — a student taken off the
 * roster is told that, not that the class closed.
 */
export type HomeworkBlock = "NOT_IN_CLASS" | "CLASS_CLOSED" | "ASSIGNMENT_CLOSED";

/** Said to a student partway through, so each one says their answers so far are kept. */
export const HOMEWORK_BLOCKED_MESSAGES: Record<HomeworkBlock, string> = {
  NOT_IN_CLASS: "You're no longer in this class, so this homework can't take new answers. The answers you gave are saved.",
  CLASS_CLOSED: "Your teacher has closed this class, so its homework can't take new answers. The answers you gave are saved.",
  ASSIGNMENT_CLOSED: "Your teacher closed this homework, so it can't take new answers. The answers you gave are saved.",
};

export function homeworkBlock(assignment: {
  closedAt: Date | null;
  classroom: { archivedAt: Date | null; enrollments: unknown[] };
}): HomeworkBlock | null {
  if (assignment.classroom.enrollments.length === 0) return "NOT_IN_CLASS";
  if (assignment.classroom.archivedAt) return "CLASS_CLOSED";
  if (assignment.closedAt) return "ASSIGNMENT_CLOSED";
  return null;
}

function blockedError(block: HomeworkBlock, assignmentId: string): TeacherError {
  return new TeacherError(block, HOMEWORK_BLOCKED_MESSAGES[block], { assignmentId });
}

/** The assignment fields `homeworkBlock` reads, for one student. */
function blockFields(studentId: string) {
  return {
    id: true,
    closedAt: true,
    classroom: {
      select: { archivedAt: true, enrollments: { where: { studentId, removedAt: null }, select: { id: true } } },
    },
  } as const;
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
          enrollments: { where: { studentId, removedAt: null }, select: { id: true, joinedAt: true } },
        },
      },
      _count: { select: { questions: true } },
      sessions: { where: { studentId }, select: { id: true, status: true } },
    },
  });
  if (!assignment) return null;
  const session = assignment.sessions[0] ?? null;
  const blocked = homeworkBlock(assignment);
  // Someone no longer in the class can still see work they finished there.
  const inClass = blocked !== "NOT_IN_CLASS" && blocked !== "CLASS_CLOSED";
  if (!inClass && !session) return null;
  const joinedAt = assignment.classroom.enrollments[0]?.joinedAt;
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
    blocked,
    setBeforeJoining: joinedAt ? joinedAfterDeadline(joinedAt, assignment) : false,
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
 * Grades and records one answer. When the student can no longer answer, it
 * throws a TeacherError carrying the block and the assignment id, which the
 * action hands to the runner as data.
 *
 * Idempotent: a retried or concurrent submit returns the first recorded
 * answer rather than grading again. The write is guarded on the slot still
 * being unanswered, so of two submits that both got past the first read only
 * one lands, and the other re-reads what it recorded.
 *
 * The last answer turns the homework in, in the same transaction. It used to
 * wait for the student to press "Turn in", so work that was all there read as
 * unfinished to the teacher forever if they closed the tab instead, and
 * couldn't be turned in at all once the teacher closed it. It also dates the
 * work by when it was done, so "late" means late.
 */
export async function finalizeHomeworkAnswer(params: {
  studentId: string;
  slotId: string;
  answer: string;
}): Promise<{ isCorrect: boolean; answer: string; completed: boolean }> {
  return prisma.$transaction(async (tx) => {
    const slot = await tx.homeworkSlot.findUnique({
      where: { id: params.slotId },
      include: {
        session: { include: { assignment: { select: blockFields(params.studentId) } } },
        question: true,
        questionRevision: { include: { answerChoices: true } },
      },
    });
    if (!slot || slot.session.studentId !== params.studentId) {
      throw new TeacherError("NOT_FOUND", "Question not found.");
    }
    if (slot.finalizedAt) {
      return { isCorrect: slot.isCorrect ?? false, answer: slot.answer ?? "", completed: slot.session.status === "COMPLETED" };
    }
    if (slot.session.status === "COMPLETED") throw new TeacherError("NOT_FOUND", "This homework is already finished.");
    const block = homeworkBlock(slot.session.assignment);
    if (block) throw blockedError(block, slot.session.assignment.id);

    const isCorrect = isAnswerCorrect(slot.question.questionType, params.answer, slot.questionRevision);
    const now = new Date();
    const written = await tx.homeworkSlot.updateMany({
      where: { id: slot.id, finalizedAt: null },
      data: { answer: params.answer, isCorrect, finalizedAt: now, draftAnswer: null, skipped: false },
    });
    if (written.count === 0) {
      const stored = await tx.homeworkSlot.findUnique({
        where: { id: slot.id },
        select: { answer: true, isCorrect: true, session: { select: { status: true } } },
      });
      return {
        isCorrect: stored?.isCorrect ?? false,
        answer: stored?.answer ?? "",
        completed: stored?.session.status === "COMPLETED",
      };
    }

    const remaining = await tx.homeworkSlot.count({ where: { sessionId: slot.sessionId, finalizedAt: null } });
    if (remaining > 0) return { isCorrect, answer: params.answer, completed: false };
    await tx.homeworkSession.updateMany({
      where: { id: slot.sessionId, status: "ACTIVE" },
      data: { status: "COMPLETED", completedAt: now },
    });
    return { isCorrect, answer: params.answer, completed: true };
  });
}

/**
 * Same rule as every other set (PRD-005 §21): finished means every question
 * answered. Idempotent: homework already turned in (normally by its last
 * answer) just succeeds, so the runner's "Turn in" lands on the results.
 *
 * Homework with every question answered is turned in even if the teacher has
 * since closed it or the student has left the class: that takes no new
 * answers, and the work is all there. It's dated by the last answer rather
 * than by now, so turning it in after the fact doesn't make it late.
 */
export async function completeHomeworkSession(studentId: string, sessionId: string): Promise<void> {
  const session = await prisma.homeworkSession.findUnique({
    where: { id: sessionId },
    include: {
      slots: { select: { finalizedAt: true } },
      assignment: { select: blockFields(studentId) },
    },
  });
  if (!session || session.studentId !== studentId) throw new TeacherError("NOT_FOUND", "Homework not found.");
  if (session.status === "COMPLETED") return;
  const unanswered = session.slots.filter((s) => !s.finalizedAt).length;
  if (unanswered > 0) {
    const block = homeworkBlock(session.assignment);
    if (block) throw blockedError(block, session.assignment.id);
    throw new TeacherError("BLANKS_REMAIN", `${unanswered} question${unanswered === 1 ? "" : "s"} remain unanswered.`, {
      unanswered,
    });
  }
  const lastAnswer = session.slots.reduce<Date | null>(
    (latest, s) => (s.finalizedAt && (!latest || s.finalizedAt > latest) ? s.finalizedAt : latest),
    null,
  );
  await prisma.homeworkSession.updateMany({
    where: { id: sessionId, status: "ACTIVE" },
    data: { status: "COMPLETED", completedAt: lastAnswer ?? new Date() },
  });
}

/**
 * The session for the runner, or null if it isn't this student's. `blocked`
 * says whether they may still answer; the page shows a closed state instead
 * of the runner when they may not.
 */
export async function getHomeworkSessionForRunner(studentId: string, sessionId: string) {
  const session = await prisma.homeworkSession.findUnique({
    where: { id: sessionId },
    include: {
      slots: { orderBy: { position: "asc" } },
      assignment: {
        select: {
          id: true,
          title: true,
          closedAt: true,
          classroom: {
            select: {
              name: true,
              archivedAt: true,
              enrollments: { where: { studentId, removedAt: null }, select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!session || session.studentId !== studentId) return null;
  return { ...session, blocked: homeworkBlock(session.assignment) };
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
  /** The same rule as the teacher's "Late" chip, so the two never disagree. */
  late: boolean;
  questions: { slotId: string; position: number; isCorrect: boolean; category: string }[];
};

export async function getHomeworkResults(studentId: string, sessionId: string): Promise<HomeworkResults | null> {
  const session = await prisma.homeworkSession.findUnique({
    where: { id: sessionId },
    include: {
      slots: { orderBy: { position: "asc" }, include: { question: { select: { category: true } } } },
      assignment: {
        select: {
          id: true,
          title: true,
          dueAt: true,
          closedAt: true,
          // Removed or not: when they joined decides whether "late" applies.
          classroom: { select: { name: true, enrollments: { where: { studentId }, select: { joinedAt: true } } } },
        },
      },
    },
  });
  if (!session || session.studentId !== studentId || session.status !== "COMPLETED") return null;
  const joinedAt = session.assignment.classroom.enrollments[0]?.joinedAt ?? null;
  return {
    sessionId: session.id,
    assignmentId: session.assignment.id,
    title: session.assignment.title,
    className: session.assignment.classroom.name,
    total: session.slots.length,
    correct: session.slots.filter((s) => s.isCorrect).length,
    completedAt: session.completedAt,
    dueAt: session.assignment.dueAt,
    late: turnedInLate(session.completedAt, session.assignment, joinedAt),
    questions: session.slots.map((s) => ({
      slotId: s.id,
      position: s.position,
      isCorrect: s.isCorrect ?? false,
      category: s.question.category,
    })),
  };
}
