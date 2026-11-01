import type { AssignmentMode, QuestionCategory, QuestionDifficulty, QuestionType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { drainForRequest } from "@/lib/email-queue";
import { localDateInputValue } from "@/lib/community/local-day";
import { ASSIGNMENT_INSTRUCTIONS_MAX, ASSIGNMENT_MAX_QUESTIONS, ASSIGNMENT_TITLE_MAX } from "./config";
import { requireOwnedAssignment, requireOwnedClassroom, type TeacherContext } from "./access";
import { TeacherError } from "./errors";
import { joinedAfterDeadline, turnedInLate } from "./deadline";
import { assignedEmailRows, formatNudgeTime, homeworkNudgeMessage, needsNudge, nudgeAvailableAt } from "./homework-email";
import { HOMEWORK_NUDGE_COOLDOWN_HOURS } from "./config";
import { teacherName } from "./names";
import { answerBreakdown, answerLabel, correctLabel, mostMissedPositions, type AnswerBreakdown } from "./answer-stats";
import { compareRosterNames } from "./names";

export type AssignmentInput = {
  title: string;
  instructions: string | null;
  dueAt: Date | null;
  mode?: AssignmentMode;
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

type OpenClassroom = Awaited<ReturnType<typeof requireOwnedClassroom>>;
type PinnedQuestion = { questionId: string; questionRevisionId: string };

/** Each class, checked to be this teacher's and not archived, before anything is written. */
async function requireOpenClassrooms(context: TeacherContext, classroomIds: string[]): Promise<OpenClassroom[]> {
  const classrooms: OpenClassroom[] = [];
  for (const classroomId of classroomIds) {
    const classroom = await requireOwnedClassroom(context, classroomId);
    if (classroom.archivedAt) {
      throw new TeacherError("CLASS_CLOSED", `${classroom.name} is archived. Restore it to assign homework.`);
    }
    classrooms.push(classroom);
  }
  return classrooms;
}

/**
 * The homework rows, their pinned questions and every student's "new
 * homework" email, in one transaction — the one way homework is created,
 * whether it was built in the builder or copied from another class's. The
 * emails are queued with the homework, so there's never homework whose
 * students were never going to hear about it; the queue delivers them (a few
 * seconds' drain here, the scheduled drain for the rest).
 */
async function insertAssignments(
  context: TeacherContext,
  classrooms: OpenClassroom[],
  input: { title: string; instructions: string | null; dueAt: Date | null; mode: AssignmentMode },
  pinned: PinnedQuestion[],
): Promise<{ classroomId: string; id: string }[]> {
  const teacher = { firstName: context.firstName, teacherDisplayName: context.teacherDisplayName };
  const rosters = await prisma.classroomEnrollment.findMany({
    where: {
      classroomId: { in: classrooms.map((c) => c.id) },
      removedAt: null,
      student: { role: "STUDENT", deletedAt: null },
    },
    select: { classroomId: true, student: { select: { email: true, firstName: true } } },
  });

  const created = await prisma.$transaction(async (tx) => {
    const made: { classroomId: string; id: string }[] = [];
    for (const classroom of classrooms) {
      const { id } = await tx.assignment.create({
        data: {
          classroomId: classroom.id,
          title: input.title,
          instructions: input.instructions,
          dueAt: input.dueAt,
          mode: input.mode,
          questions: {
            create: pinned.map((q, position) => ({
              position,
              questionId: q.questionId,
              questionRevisionId: q.questionRevisionId,
            })),
          },
        },
        select: { id: true },
      });
      const students = rosters.filter((r) => r.classroomId === classroom.id).map((r) => r.student);
      const rows = assignedEmailRows(
        {
          teacher,
          className: classroom.name,
          title: input.title,
          questionCount: pinned.length,
          dueAt: input.dueAt,
          mode: input.mode,
          assignmentId: id,
        },
        students,
      );
      if (rows.length > 0) await tx.queuedEmail.createMany({ data: rows });
      made.push({ classroomId: classroom.id, id });
    }
    return made;
  });
  await drainForRequest();
  return created;
}

/**
 * Assigns a fixed list of questions to one or more of the teacher's classes
 * — a teacher with five periods of one course builds the homework once. Each
 * class gets its own assignment, with its own results. Each question is
 * pinned to the revision published right now, so every class works on
 * exactly what the teacher looked at even if the Owner edits it tomorrow.
 *
 * Only published questions can be assigned — the same pool every student
 * surface draws from — and the order given is the order students see. Every
 * student in each class is emailed that it exists (insertAssignments).
 */
export async function createAssignments(
  context: TeacherContext,
  classroomIds: string[],
  input: AssignmentInput & { questionIds: string[] },
  now: Date = new Date(),
): Promise<{ classroomId: string; id: string }[]> {
  const targets = [...new Set(classroomIds)];
  if (targets.length === 0) throw new TeacherError("INVALID_INPUT", "Pick a class to assign this to.");
  const classrooms = await requireOpenClassrooms(context, targets);

  const clean = cleanInput(input, now);
  const mode = input.mode === "QUIZ" ? "QUIZ" : "PRACTICE";
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

  return insertAssignments(
    context,
    classrooms,
    { ...clean, mode },
    questionIds.map((questionId) => ({ questionId, questionRevisionId: revisionById.get(questionId)! })),
  );
}

/**
 * "Assign to another class": the same homework — title, instructions, mode
 * and the very revisions the first class was given — for more of the
 * teacher's classes, with a new due date. The revisions are copied as they
 * were pinned, not looked up again: a QuestionRevision never changes, so they
 * stay valid even if the Owner has since edited or unpublished the question,
 * and every period works on exactly what the first one did. Each copy is its
 * own assignment with its own results, created and emailed exactly as one
 * built from scratch.
 */
export async function assignToMoreClasses(
  context: TeacherContext,
  assignmentId: string,
  classroomIds: string[],
  input: { dueAt: Date | null },
  now: Date = new Date(),
): Promise<{ classroomId: string; id: string }[]> {
  const source = await requireOwnedAssignment(context, assignmentId);
  // Its own class already has it; a second copy there would be two homeworks
  // with one title that students couldn't tell apart.
  const targets = [...new Set(classroomIds)].filter((id) => id !== source.classroomId);
  if (targets.length === 0) throw new TeacherError("INVALID_INPUT", "Pick a class to assign this to.");
  const classrooms = await requireOpenClassrooms(context, targets);
  const clean = cleanInput({ title: source.title, instructions: source.instructions, dueAt: input.dueAt }, now);
  const pinned = await prisma.assignmentQuestion.findMany({
    where: { assignmentId },
    orderBy: { position: "asc" },
    select: { questionId: true, questionRevisionId: true },
  });
  if (pinned.length === 0) throw new TeacherError("INVALID_INPUT", "This homework has no questions to copy.");
  return insertAssignments(context, classrooms, { ...clean, mode: source.mode }, pinned);
}

/** One class: the original entry point, kept for callers that assign to a single class. */
export async function createAssignment(
  context: TeacherContext,
  classroomId: string,
  input: AssignmentInput & { questionIds: string[] },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const [created] = await createAssignments(context, [classroomId], input, now);
  return { id: created.id };
}

/**
 * Title, instructions, due date and mode. The questions themselves never
 * change once assigned, and the mode can't change once a student has
 * started: switching a quiz to practice halfway would show answers to some
 * students and not others.
 */
export async function updateAssignment(context: TeacherContext, assignmentId: string, input: AssignmentInput, now: Date = new Date()) {
  const assignment = await requireOwnedAssignment(context, assignmentId);
  // The form sends a calendar day, which the action turns into the end of
  // that day, so "did it change?" is a question about days. Comparing
  // timestamps treated any due date not exactly at end-of-day Central (the
  // demo district's, for one) as moved: a title-only save on past-due
  // homework was refused for its date, and on future homework it silently
  // shifted the deadline and re-armed the reminder. An unchanged day keeps
  // the stored moment, and a due date already in the past may stay as it is;
  // only a *new* one has to be in the future.
  const dueUnchanged = localDateInputValue(assignment.dueAt) === localDateInputValue(input.dueAt);
  const clean = cleanInput({ ...input, dueAt: dueUnchanged ? null : input.dueAt }, now);
  const mode = input.mode ?? assignment.mode;
  const data = {
    title: clean.title,
    instructions: clean.instructions,
    dueAt: dueUnchanged ? assignment.dueAt : clean.dueAt,
    mode,
    // A new due date gets its own day-before reminder.
    ...(dueUnchanged ? {} : { reminderQueuedAt: null }),
  };
  if (mode === assignment.mode) {
    await prisma.assignment.update({ where: { id: assignmentId }, data });
    return;
  }
  // "Nobody has started" is checked by the write itself, not by a count
  // before it: a student starting in the gap would otherwise begin a quiz
  // that then turned into practice under them.
  const changed = await prisma.assignment.updateMany({ where: { id: assignmentId, sessions: { none: {} } }, data });
  if (changed.count === 0) {
    throw new TeacherError(
      "HAS_WORK",
      `Students have started it, so it stays ${assignment.mode === "QUIZ" ? "a quiz" : "practice"}.`,
    );
  }
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
  // One guarded statement rather than a count and then a delete: sessions
  // cascade with their assignment, so a student who started in the gap would
  // have had their work deleted with it.
  const deleted = await prisma.assignment.deleteMany({ where: { id: assignmentId, sessions: { none: {} } } });
  if (deleted.count === 0) {
    throw new TeacherError("HAS_WORK", "Students have started this one, so it can be closed but not deleted.");
  }
}

/**
 * "Remind the N who haven't finished": an email from the teacher to every
 * student on the roster now who hasn't turned the homework in (needsNudge),
 * before or after the due date, for as long as it's open. Never anyone the
 * teacher removed, and never a student who joined after it was due.
 *
 * At most once per homework in HOMEWORK_NUDGE_COOLDOWN_HOURS. The cooldown is
 * claimed in the same transaction that queues the emails, guarded on the last
 * reminder being old enough (and the homework still open), so a double click
 * or two tabs send it once — the same claim-then-queue shape as the daily
 * reminder. Returns how many were emailed; nothing is claimed when that's
 * nobody.
 */
export async function remindUnfinished(
  context: TeacherContext,
  assignmentId: string,
  now: Date = new Date(),
): Promise<{ sent: number }> {
  const assignment = await requireOwnedAssignment(context, assignmentId);
  if (assignment.classroom.archivedAt) {
    throw new TeacherError("CLASS_CLOSED", "This class is archived, so its students can't open this homework.");
  }
  if (assignment.closedAt) {
    throw new TeacherError("ASSIGNMENT_CLOSED", "This homework is closed, so nobody can finish it. Reopen it first.");
  }
  const wait = nudgeAvailableAt(assignment.lastNudgedAt, now);
  if (wait) throw new TeacherError("LIMIT", `You can send the next reminder after ${formatNudgeTime(wait)}.`);

  const [enrollments, sessions, questionCount] = await Promise.all([
    prisma.classroomEnrollment.findMany({
      where: { classroomId: assignment.classroomId, removedAt: null, student: { role: "STUDENT", deletedAt: null } },
      select: { joinedAt: true, student: { select: { id: true, email: true, firstName: true } } },
    }),
    prisma.homeworkSession.findMany({
      where: { assignmentId },
      select: { studentId: true, status: true, _count: { select: { slots: { where: { finalizedAt: { not: null } } } } } },
    }),
    prisma.assignmentQuestion.count({ where: { assignmentId } }),
  ]);
  const sessionByStudent = new Map(sessions.map((s) => [s.studentId, s]));
  const teacher = teacherName(context);
  const rows = enrollments
    .filter((e) =>
      needsNudge({
        enrolled: true,
        completed: sessionByStudent.get(e.student.id)?.status === "COMPLETED",
        joinedLater: joinedAfterDeadline(e.joinedAt, assignment),
      }),
    )
    .map((e) =>
      homeworkNudgeMessage({
        student: e.student,
        teacher,
        className: assignment.classroom.name,
        title: assignment.title,
        questionCount,
        answered: sessionByStudent.get(e.student.id)?._count.slots ?? 0,
        dueAt: assignment.dueAt,
        assignmentId,
        now,
      }),
    );
  if (rows.length === 0) return { sent: 0 };

  const cutoff = new Date(now.getTime() - HOMEWORK_NUDGE_COOLDOWN_HOURS * 60 * 60 * 1000);
  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.assignment.updateMany({
      where: { id: assignmentId, closedAt: null, OR: [{ lastNudgedAt: null }, { lastNudgedAt: { lte: cutoff } }] },
      data: { lastNudgedAt: now },
    });
    if (claim.count === 0) return false;
    await tx.queuedEmail.createMany({ data: rows });
    return true;
  });
  // Lost the claim to a second click or another tab: that one sent it.
  if (!claimed) throw new TeacherError("LIMIT", "A reminder for this homework was just sent.");
  await drainForRequest();
  return { sent: rows.length };
}

export type SubmissionStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export type AssignmentResults = {
  id: string;
  title: string;
  instructions: string | null;
  dueAt: Date | null;
  closed: boolean;
  mode: AssignmentMode;
  createdAt: Date;
  classroom: { id: string; name: string; archived: boolean };
  questions: {
    position: number;
    questionId: string;
    category: QuestionCategory;
    difficulty: QuestionDifficulty;
    questionType: QuestionType;
    answered: number;
    correct: number;
    /** "B", or a grid-in's first accepted answer. */
    correctAnswer: string;
    /** What the class answered: each choice's count, or the common wrong entries. */
    breakdown: AnswerBreakdown;
    /** One of the (at most two) questions most worth going over in class. */
    mostMissed: boolean;
  }[];
  students: {
    studentId: string;
    firstName: string;
    /** The last name they gave this class, or null if they haven't. */
    lastName: string | null;
    email: string;
    /** Still on the roster. A removed student's finished work stays listed. */
    enrolled: boolean;
    /**
     * Joined the class after this homework was already due (or closed). Not
     * started, such a student is "Joined later", never "Missing", and isn't
     * counted as not started.
     */
    joinedLater: boolean;
    status: SubmissionStatus;
    answered: number;
    correct: number;
    completedAt: Date | null;
    late: boolean;
    /** Positions (0-based) this student got wrong, for the per-student breakdown. */
    missed: number[];
    /** Each question this student has answered: what they gave ("C", "3/4") and whether it was right. */
    answers: { position: number; answer: string; isCorrect: boolean }[];
  }[];
  /**
   * Everything "of the class" counts the current roster only, so
   * completed + inProgress + notStarted + joinedLater = roster. Finished work
   * from students who have since left is counted on its own, in leftCompleted.
   */
  summary: {
    roster: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    joinedLater: number;
    leftCompleted: number;
    averagePercent: number | null;
  };
  /**
   * "Remind the N who haven't finished": how many it would email (needsNudge,
   * the same rule the send itself uses), when the last one went, and when the
   * next may — null once it can go now.
   */
  reminder: { recipients: number; lastSentAt: Date | null; nextAllowedAt: Date | null };
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
export async function getAssignmentResults(
  context: TeacherContext,
  assignmentId: string,
  now: Date = new Date(),
): Promise<AssignmentResults> {
  const assignment = await requireOwnedAssignment(context, assignmentId);

  const [questions, enrollments, sessions] = await Promise.all([
    prisma.assignmentQuestion.findMany({
      where: { assignmentId },
      orderBy: { position: "asc" },
      select: {
        position: true,
        questionId: true,
        question: { select: { category: true, difficulty: true, questionType: true } },
        // The revision the class was given, for its answer key.
        questionRevision: {
          select: { acceptedAnswers: true, answerChoices: { orderBy: { order: "asc" }, select: { id: true, isCorrect: true } } },
        },
      },
    }),
    // Removed students too: when they joined still decides whether their work was late.
    prisma.classroomEnrollment.findMany({
      where: { classroomId: assignment.classroomId },
      select: { joinedAt: true, removedAt: true, lastName: true, student: { select: { id: true, firstName: true, email: true } } },
    }),
    prisma.homeworkSession.findMany({
      where: { assignmentId },
      select: {
        studentId: true,
        status: true,
        completedAt: true,
        student: { select: { firstName: true, email: true } },
        slots: { select: { position: true, isCorrect: true, finalizedAt: true, answer: true } },
      },
    }),
  ]);

  const keyByPosition = new Map(
    questions.map((q) => [
      q.position,
      {
        questionType: q.question.questionType,
        choices: q.questionRevision.answerChoices,
        acceptedAnswers: q.questionRevision.acceptedAnswers,
      },
    ]),
  );
  const finalizedSlots = sessions.flatMap((s) => s.slots.filter((slot) => slot.finalizedAt));
  const perQuestion = questions.map((q) => {
    const key = keyByPosition.get(q.position)!;
    const given = finalizedSlots.filter((slot) => slot.position === q.position);
    return {
      position: q.position,
      questionId: q.questionId,
      category: q.question.category,
      difficulty: q.question.difficulty,
      questionType: q.question.questionType,
      answered: given.length,
      correct: given.filter((slot) => slot.isCorrect).length,
      correctAnswer: correctLabel(key),
      breakdown: answerBreakdown(key, given),
      mostMissed: false,
    };
  });
  const mostMissed = mostMissedPositions(perQuestion);
  for (const q of perQuestion) q.mostMissed = mostMissed.has(q.position);

  const sessionByStudent = new Map(sessions.map((s) => [s.studentId, s]));
  const roster = enrollments.filter((e) => e.removedAt === null);
  const rosterIds = new Set(roster.map((e) => e.student.id));
  const joinedAtByStudent = new Map(enrollments.map((e) => [e.student.id, e.joinedAt]));
  const lastNameByStudent = new Map(enrollments.map((e) => [e.student.id, e.lastName]));
  const people = [
    ...roster.map((e) => ({ studentId: e.student.id, firstName: e.student.firstName, email: e.student.email, enrolled: true })),
    // Removed after starting: their work happened, so it stays in the results.
    ...sessions
      .filter((s) => !rosterIds.has(s.studentId))
      .map((s) => ({ studentId: s.studentId, firstName: s.student.firstName, email: s.student.email, enrolled: false })),
  ];

  const students = people.map((p) => {
    const session = sessionByStudent.get(p.studentId);
    const finalized = session?.slots.filter((slot) => slot.finalizedAt) ?? [];
    const status: SubmissionStatus = !session ? "NOT_STARTED" : session.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS";
    const joinedAt = joinedAtByStudent.get(p.studentId) ?? null;
    return {
      ...p,
      lastName: lastNameByStudent.get(p.studentId) ?? null,
      answers: finalized
        .map((slot) => ({
          position: slot.position,
          answer: answerLabel(keyByPosition.get(slot.position)!, slot.answer),
          isCorrect: slot.isCorrect === true,
        }))
        .sort((x, y) => x.position - y.position),
      joinedLater: joinedAt !== null && joinedAfterDeadline(joinedAt, assignment),
      status,
      answered: finalized.length,
      correct: finalized.filter((slot) => slot.isCorrect).length,
      completedAt: session?.completedAt ?? null,
      late: turnedInLate(session?.completedAt ?? null, assignment, joinedAt),
      missed: finalized
        .filter((slot) => !slot.isCorrect)
        .map((slot) => slot.position)
        .sort((x, y) => x - y),
    };
  });

  // Finished first (best score first), then in progress, then not started,
  // then those who joined after it was due — the order a teacher scans for
  // "who still owes me this".
  const rank = (s: (typeof students)[number]) =>
    s.status === "COMPLETED" ? 0 : s.status === "IN_PROGRESS" ? 1 : s.joinedLater ? 3 : 2;
  students.sort((a, b) => rank(a) - rank(b) || b.correct - a.correct || compareRosterNames(a, b));

  const total = questions.length;
  const current = students.filter((s) => s.enrolled);
  const completed = current.filter((s) => s.status === "COMPLETED");
  return {
    id: assignment.id,
    title: assignment.title,
    instructions: assignment.instructions,
    dueAt: assignment.dueAt,
    closed: assignment.closedAt !== null,
    mode: assignment.mode,
    createdAt: assignment.createdAt,
    classroom: {
      id: assignment.classroom.id,
      name: assignment.classroom.name,
      archived: assignment.classroom.archivedAt !== null,
    },
    questions: perQuestion,
    students,
    summary: {
      roster: current.length,
      completed: completed.length,
      inProgress: current.filter((s) => s.status === "IN_PROGRESS").length,
      notStarted: current.filter((s) => s.status === "NOT_STARTED" && !s.joinedLater).length,
      joinedLater: current.filter((s) => s.status === "NOT_STARTED" && s.joinedLater).length,
      leftCompleted: students.filter((s) => !s.enrolled && s.status === "COMPLETED").length,
      averagePercent:
        completed.length > 0 && total > 0
          ? Math.round((completed.reduce((sum, s) => sum + s.correct, 0) / (completed.length * total)) * 100)
          : null,
    },
    reminder: {
      recipients: students.filter((s) => needsNudge({ ...s, completed: s.status === "COMPLETED" })).length,
      lastSentAt: assignment.lastNudgedAt,
      nextAllowedAt: nudgeAvailableAt(assignment.lastNudgedAt, now),
    },
  };
}
