import { prisma } from "@/lib/prisma";
import { CLASSROOM_NAME_MAX, CLASSROOMS_PER_TEACHER_MAX } from "./config";
import { requireOwnedClassroom, type TeacherContext } from "./access";
import { TeacherError } from "./errors";
import { generateJoinCode } from "./join-code";

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
};

export async function listClassrooms(context: TeacherContext, now: Date = new Date()): Promise<ClassroomSummary[]> {
  const rows = await prisma.classroom.findMany({
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
      enrollments: { where: { removedAt: null }, select: { studentId: true } },
      assignments: {
        where: { closedAt: null, dueAt: { gte: now } },
        orderBy: { dueAt: "asc" },
        take: 1,
        select: { id: true, title: true, dueAt: true, sessions: { where: { status: "COMPLETED" }, select: { studentId: true } } },
      },
    },
  });
  return rows.map((r) => {
    const next = r.assignments[0];
    const roster = new Set(r.enrollments.map((e) => e.studentId));
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
    };
  });
}

export type ClassroomDetail = {
  id: string;
  name: string;
  joinCode: string;
  archived: boolean;
  students: { studentId: string; firstName: string; email: string; joinedAt: Date; completedAssignments: number }[];
  /**
   * Every student's result on every assignment they've opened, for the class
   * gradebook. A student with no row for an assignment hasn't started it.
   */
  submissions: { studentId: string; assignmentId: string; status: "IN_PROGRESS" | "COMPLETED"; correct: number }[];
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
    createdAt: Date;
    questionCount: number;
    completed: number;
    inProgress: number;
    /** Mean percent correct over finished submissions; null until one exists. */
    averagePercent: number | null;
  }[];
};

/**
 * Everything the class page shows, in a fixed number of queries however big
 * the class: the roster, the assignments, and one grouped read of every
 * submission's status and score.
 */
export async function getClassroomDetail(context: TeacherContext, classroomId: string): Promise<ClassroomDetail> {
  const classroom = await requireOwnedClassroom(context, classroomId);

  const [enrollments, assignments, sessions] = await Promise.all([
    prisma.classroomEnrollment.findMany({
      where: { classroomId, removedAt: null },
      orderBy: { student: { firstName: "asc" } },
      select: { joinedAt: true, student: { select: { id: true, firstName: true, email: true } } },
    }),
    prisma.assignment.findMany({
      where: { classroomId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, dueAt: true, closedAt: true, createdAt: true, _count: { select: { questions: true } } },
    }),
    prisma.homeworkSession.findMany({
      where: { assignment: { classroomId } },
      select: {
        assignmentId: true,
        studentId: true,
        status: true,
        _count: { select: { slots: { where: { isCorrect: true } } } },
        assignment: { select: { _count: { select: { questions: true } } } },
      },
    }),
  ]);

  const roster = new Set(enrollments.map((e) => e.student.id));
  const completedByStudent = new Map<string, number>();
  const byAssignment = new Map<string, { completed: number; inProgress: number; percents: number[] }>();
  for (const s of sessions) {
    if (!roster.has(s.studentId)) continue;
    const entry = byAssignment.get(s.assignmentId) ?? { completed: 0, inProgress: 0, percents: [] };
    if (s.status === "COMPLETED") {
      entry.completed++;
      const total = s.assignment._count.questions;
      if (total > 0) entry.percents.push((s._count.slots / total) * 100);
      completedByStudent.set(s.studentId, (completedByStudent.get(s.studentId) ?? 0) + 1);
    } else {
      entry.inProgress++;
    }
    byAssignment.set(s.assignmentId, entry);
  }

  return {
    id: classroom.id,
    name: classroom.name,
    joinCode: classroom.joinCode,
    archived: classroom.archivedAt !== null,
    students: enrollments.map((e) => ({
      studentId: e.student.id,
      firstName: e.student.firstName,
      email: e.student.email,
      joinedAt: e.joinedAt,
      completedAssignments: completedByStudent.get(e.student.id) ?? 0,
    })),
    submissions: sessions.map((s) => ({
      studentId: s.studentId,
      assignmentId: s.assignmentId,
      status: s.status === "COMPLETED" ? ("COMPLETED" as const) : ("IN_PROGRESS" as const),
      correct: s._count.slots,
    })),
    assignments: assignments.map((a) => {
      const stats = byAssignment.get(a.id);
      return {
        id: a.id,
        title: a.title,
        dueAt: a.dueAt,
        closedAt: a.closedAt,
        closed: a.closedAt !== null,
        createdAt: a.createdAt,
        questionCount: a._count.questions,
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
