import type { AssignmentMode } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { CLASSROOM_NAME_MAX, CLASSROOMS_PER_TEACHER_MAX } from "./config";
import { requireOwnedClassroom, type TeacherContext } from "./access";
import { TeacherError } from "./errors";
import { generateJoinCode } from "./join-code";
import { cleanTeacherDisplayName, compareRosterNames } from "./names";
import { joinedAfterDeadline, turnedInLate } from "./deadline";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new TeacherError("INVALID_INPUT", "Give the class a name.");
  if (name.length > CLASSROOM_NAME_MAX) {
    throw new TeacherError("INVALID_INPUT", `Keep the class name under ${CLASSROOM_NAME_MAX} characters.`);
  }
  return name;
}

/**
 * A fresh join code that no class holds. The unique index is the real
 * guarantee; a collision just means drawing again, and at 244 million codes
 * five draws failing in a row would mean something else is wrong.
 */
async function withFreshJoinCode<T>(write: (joinCode: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await write(generateJoinCode());
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error("Could not generate a unique class code.");
}

export async function createClassroom(context: TeacherContext, rawName: string): Promise<{ id: string }> {
  const name = cleanName(rawName);
  const open = await prisma.classroom.count({ where: { teacherId: context.userId, archivedAt: null } });
  if (open >= CLASSROOMS_PER_TEACHER_MAX) {
    throw new TeacherError("LIMIT", "That's a lot of classes — archive one you've finished with first.");
  }
  return withFreshJoinCode((joinCode) =>
    prisma.classroom.create({
      data: { teacherId: context.userId, schoolId: context.schoolId, name, joinCode },
      select: { id: true },
    }),
  );
}

export async function renameClassroom(context: TeacherContext, classroomId: string, rawName: string) {
  await requireOwnedClassroom(context, classroomId);
  await prisma.classroom.update({ where: { id: classroomId }, data: { name: cleanName(rawName) } });
}

/**
 * A new code, for when the old one was shared somewhere it shouldn't have
 * been. Students already in the class stay in it; only the old code stops
 * working.
 */
export async function regenerateJoinCode(context: TeacherContext, classroomId: string): Promise<string> {
  await requireOwnedClassroom(context, classroomId);
  const updated = await withFreshJoinCode((joinCode) =>
    prisma.classroom.update({ where: { id: classroomId }, data: { joinCode }, select: { joinCode: true } }),
  );
  return updated.joinCode;
}

/**
 * Closes a class: nobody can join, its homework disappears from students'
 * lists, and nothing is deleted. Reversible.
 */
export async function setClassroomArchived(context: TeacherContext, classroomId: string, archived: boolean) {
  await requireOwnedClassroom(context, classroomId);
  await prisma.classroom.update({ where: { id: classroomId }, data: { archivedAt: archived ? new Date() : null } });
}

/** Takes a student off the roster. Their finished homework stays in the results. */
export async function removeStudentFromClassroom(context: TeacherContext, classroomId: string, studentId: string) {
  await requireOwnedClassroom(context, classroomId);
  await prisma.classroomEnrollment.updateMany({
    where: { classroomId, studentId, removedAt: null },
    data: { removedAt: new Date() },
  });
}

/**
 * The name the teacher's students see on homework, emails and the join page
 * ("Ms. Alvarez"). Empty clears it back to their first name.
 */
export async function setTeacherDisplayName(context: TeacherContext, raw: string): Promise<void> {
  const teacherDisplayName = raw.trim() ? cleanTeacherDisplayName(raw) : null;
  await prisma.user.update({ where: { id: context.userId }, data: { teacherDisplayName } });
}

export type ClassroomSummary = {
  id: string;
  name: string;
  joinCode: string;
  archived: boolean;
  studentCount: number;
  assignmentCount: number;
  /**
   * The open homework due soonest, for the class card: what's next, and how
   * many of the students now in the class have finished it.
   */
  nextDue: { id: string; title: string; dueAt: Date; completed: number } | null;
  /**
   * The most recent homework whose due date has passed and which is still
   * open, while anyone now in the class owes it — so "Nothing due right now"
   * never hides missing work. `unfinished` leaves out students who joined
   * after it was due, like every "Missing" count.
   */
  overdue: { id: string; title: string; dueAt: Date; unfinished: number } | null;
};

export async function listClassrooms(context: TeacherContext, now: Date = new Date()): Promise<ClassroomSummary[]> {
  const [rows, pastDue] = await Promise.all([
    prisma.classroom.findMany({
      where: { teacherId: context.userId, schoolId: context.schoolId },
      orderBy: [{ archivedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        joinCode: true,
        archivedAt: true,
        _count: { select: { assignments: true } },
        // Ids rather than a count: "N of M done" has to count finished work from
        // the students in the class now, or someone who finished and then left
        // makes it "5 of 4".
        enrollments: { where: { removedAt: null }, select: { studentId: true, joinedAt: true } },
        assignments: {
          where: { closedAt: null, dueAt: { gte: now } },
          orderBy: { dueAt: "asc" },
          take: 1,
          select: {
            id: true,
            title: true,
            dueAt: true,
            sessions: { where: { status: "COMPLETED" }, select: { studentId: true } },
          },
        },
      },
    }),
    // Scalars only, newest first; the first per class is the one shown. A
    // relation can't be selected twice in one query, hence the second read.
    prisma.assignment.findMany({
      where: {
        classroom: { teacherId: context.userId, schoolId: context.schoolId, archivedAt: null },
        closedAt: null,
        dueAt: { lt: now },
      },
      orderBy: { dueAt: "desc" },
      select: { id: true, classroomId: true, title: true, dueAt: true, closedAt: true },
    }),
  ]);

  const latestPastDue = new Map<string, (typeof pastDue)[number]>();
  for (const a of pastDue) if (!latestPastDue.has(a.classroomId)) latestPastDue.set(a.classroomId, a);
  const overdueIds = [...latestPastDue.values()].map((a) => a.id);
  // Finished work on just those, one row per finished student — bounded by
  // the number of classes, never by how much homework a teacher has set.
  const finished =
    overdueIds.length > 0
      ? await prisma.homeworkSession.findMany({
          where: { assignmentId: { in: overdueIds }, status: "COMPLETED" },
          select: { assignmentId: true, studentId: true },
        })
      : [];
  const finishedBy = new Set(finished.map((s) => `${s.assignmentId}:${s.studentId}`));

  return rows.map((r) => {
    const next = r.assignments[0];
    const roster = new Set(r.enrollments.map((e) => e.studentId));
    const late = latestPastDue.get(r.id);
    const unfinished = late
      ? r.enrollments.filter(
          (e) => !finishedBy.has(`${late.id}:${e.studentId}`) && !joinedAfterDeadline(e.joinedAt, late),
        ).length
      : 0;
    return {
      id: r.id,
      name: r.name,
      joinCode: r.joinCode,
      archived: r.archivedAt !== null,
      studentCount: roster.size,
      assignmentCount: r._count.assignments,
      nextDue: next?.dueAt
        ? {
            id: next.id,
            title: next.title,
            dueAt: next.dueAt,
            completed: next.sessions.filter((s) => roster.has(s.studentId)).length,
          }
        : null,
      overdue: late?.dueAt && unfinished > 0 ? { id: late.id, title: late.title, dueAt: late.dueAt, unfinished } : null,
    };
  });
}

/**
 * The teacher's other open classes, by name — the builder's "Also assign to"
 * and the results page's "Assign to another class".
 */
export async function listOtherOpenClasses(context: TeacherContext, exceptClassroomId: string) {
  return prisma.classroom.findMany({
    where: { teacherId: context.userId, schoolId: context.schoolId, archivedAt: null, id: { not: exceptClassroomId } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export type ClassroomStudent = {
  studentId: string;
  firstName: string;
  lastName: string | null;
  email: string;
  joinedAt: Date;
  completedAssignments: number;
};

export type ClassroomDetail = {
  id: string;
  name: string;
  joinCode: string;
  archived: boolean;
  /** Alphabetical by last name (names.ts), students who haven't given one last. */
  students: ClassroomStudent[];
  /**
   * Students taken off the roster (or who left) after doing some of this
   * class's homework, so their grades can still be read and downloaded. Kept
   * apart from `students`: every "of N" on the class page counts the roster
   * as it is now.
   */
  formerStudents: (ClassroomStudent & { leftAt: Date })[];
  /**
   * Every student's result on every assignment they've opened, for the class
   * gradebook. A student with no row for an assignment hasn't started it.
   * `late` is turnedInLate, the rule the assignment's own results use.
   */
  submissions: {
    studentId: string;
    assignmentId: string;
    status: "IN_PROGRESS" | "COMPLETED";
    correct: number;
    completedAt: Date | null;
    late: boolean;
  }[];
  /**
   * Completed, in progress and the average count the students in the class
   * now, so they always add up against the roster; finished work from anyone
   * who has left stays on the assignment's own results page.
   */
  assignments: {
    id: string;
    title: string;
    dueAt: Date | null;
    closedAt: Date | null;
    closed: boolean;
    mode: AssignmentMode;
    createdAt: Date;
    questionCount: number;
    completed: number;
    inProgress: number;
    /**
     * Students on the roster it was set for: everyone except those who joined after it was due and haven't
     * started it, as the homework's own page counts them (review, 2026-11-09: "16 of 24" here, "16 of 23" there).
     */
    expected: number;
    /** Mean percent correct over finished submissions; null until one exists. */
    averagePercent: number | null;
  }[];
};

/**
 * Everything the class page shows, in a fixed number of queries however big
 * the class: the roster (and anyone removed after doing work), the
 * assignments, and one grouped read of every submission's status and score.
 */
export async function getClassroomDetail(context: TeacherContext, classroomId: string): Promise<ClassroomDetail> {
  const classroom = await requireOwnedClassroom(context, classroomId);

  const [enrollments, assignments, sessions] = await Promise.all([
    // Removed students too: their finished work is still a grade, and when
    // they joined still decides whether it was late.
    prisma.classroomEnrollment.findMany({
      where: { classroomId },
      select: {
        joinedAt: true,
        removedAt: true,
        lastName: true,
        student: { select: { id: true, firstName: true, email: true } },
      },
    }),
    prisma.assignment.findMany({
      where: { classroomId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        dueAt: true,
        closedAt: true,
        mode: true,
        createdAt: true,
        _count: { select: { questions: true } },
      },
    }),
    prisma.homeworkSession.findMany({
      where: { assignment: { classroomId } },
      select: {
        assignmentId: true,
        studentId: true,
        status: true,
        completedAt: true,
        _count: { select: { slots: { where: { isCorrect: true } } } },
      },
    }),
  ]);

  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const roster = new Set(enrollments.filter((e) => e.removedAt === null).map((e) => e.student.id));
  const joinedAtByStudent = new Map(enrollments.map((e) => [e.student.id, e.joinedAt]));
  const completedByStudent = new Map<string, number>();
  const byAssignment = new Map<string, { completed: number; inProgress: number; percents: number[] }>();
  const worked = new Set<string>();
  for (const s of sessions) {
    worked.add(s.studentId);
    if (s.status === "COMPLETED") completedByStudent.set(s.studentId, (completedByStudent.get(s.studentId) ?? 0) + 1);
    // The per-homework figures count the roster as it is now.
    if (!roster.has(s.studentId)) continue;
    const entry = byAssignment.get(s.assignmentId) ?? { completed: 0, inProgress: 0, percents: [] };
    if (s.status === "COMPLETED") {
      entry.completed++;
      const total = assignmentById.get(s.assignmentId)?._count.questions ?? 0;
      if (total > 0) entry.percents.push((s._count.slots / total) * 100);
    } else {
      entry.inProgress++;
    }
    byAssignment.set(s.assignmentId, entry);
  }

  const toStudent = (e: (typeof enrollments)[number]): ClassroomStudent => ({
    studentId: e.student.id,
    firstName: e.student.firstName,
    lastName: e.lastName,
    email: e.student.email,
    joinedAt: e.joinedAt,
    completedAssignments: completedByStudent.get(e.student.id) ?? 0,
  });

  return {
    id: classroom.id,
    name: classroom.name,
    joinCode: classroom.joinCode,
    archived: classroom.archivedAt !== null,
    students: enrollments.filter((e) => e.removedAt === null).map(toStudent).sort(compareRosterNames),
    // Someone removed before doing anything has no grade to keep.
    formerStudents: enrollments
      .filter((e) => e.removedAt !== null && worked.has(e.student.id))
      .map((e) => ({ ...toStudent(e), leftAt: e.removedAt! }))
      .sort(compareRosterNames),
    submissions: sessions.map((s) => {
      const assignment = assignmentById.get(s.assignmentId);
      return {
        studentId: s.studentId,
        assignmentId: s.assignmentId,
        status: s.status === "COMPLETED" ? ("COMPLETED" as const) : ("IN_PROGRESS" as const),
        correct: s._count.slots,
        completedAt: s.completedAt,
        late: assignment ? turnedInLate(s.completedAt, assignment, joinedAtByStudent.get(s.studentId) ?? null) : false,
      };
    }),
    assignments: assignments.map((a) => {
      const stats = byAssignment.get(a.id);
      return {
        id: a.id,
        title: a.title,
        dueAt: a.dueAt,
        closedAt: a.closedAt,
        closed: a.closedAt !== null,
        mode: a.mode,
        createdAt: a.createdAt,
        questionCount: a._count.questions,
        expected: enrollments.filter(
          (e) =>
            e.removedAt === null &&
            (!joinedAfterDeadline(e.joinedAt, a) || sessions.some((x) => x.assignmentId === a.id && x.studentId === e.student.id)),
        ).length,
        completed: stats?.completed ?? 0,
        inProgress: stats?.inProgress ?? 0,
        averagePercent:
          stats && stats.percents.length > 0
            ? Math.round(stats.percents.reduce((sum, p) => sum + p, 0) / stats.percents.length)
            : null,
      };
    }),
  };
}
