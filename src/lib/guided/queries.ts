import type { ExtraTime } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeJoinCode } from "@/lib/teacher/join-code";
import { teacherName } from "@/lib/teacher/names";
import { CATCH_UP_DAYS } from "./config";
import { sessionSkillLabel } from "./modes";

const DAY_MS = 24 * 60 * 60 * 1000;

export type OpenSessionLink = { id: string; className: string; teacherName: string; joined: boolean };

/** Sessions open right now in this student's classes: the "Live now" banner. One query. */
export async function listOpenSessionsForStudent(studentId: string): Promise<OpenSessionLink[]> {
  const sessions = await prisma.guidedSession.findMany({
    where: {
      status: "OPEN",
      classroom: { archivedAt: null, enrollments: { some: { studentId, removedAt: null } } },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      classroom: { select: { name: true } },
      teacher: { select: { firstName: true, teacherDisplayName: true } },
      participants: { where: { studentId }, select: { id: true } },
    },
  });
  return sessions.map((s) => ({
    id: s.id,
    className: s.classroom.name,
    teacherName: teacherName(s.teacher),
    joined: s.participants.length > 0,
  }));
}

export type CodeLookup =
  | { kind: "SESSION"; sessionId: string }
  | { kind: "NOT_IN_CLASS"; classJoinCode: string; className: string }
  | { kind: "ENDED" }
  | { kind: "NOT_FOUND" };

/** What a code typed at /live leads to. Joining a class is a separate step, on its own page. */
export async function lookupSessionCode(studentId: string, raw: string): Promise<CodeLookup> {
  const code = normalizeJoinCode(raw);
  if (!code) return { kind: "NOT_FOUND" };
  const session = await prisma.guidedSession.findUnique({
    where: { joinCode: code },
    select: {
      id: true,
      status: true,
      classroom: {
        select: { name: true, joinCode: true, archivedAt: true, enrollments: { where: { studentId, removedAt: null }, select: { id: true } } },
      },
    },
  });
  if (!session || session.classroom.archivedAt) return { kind: "NOT_FOUND" };
  if (session.status === "ENDED") return { kind: "ENDED" };
  if (session.classroom.enrollments.length === 0) {
    return { kind: "NOT_IN_CLASS", classJoinCode: session.classroom.joinCode, className: session.classroom.name };
  }
  return { kind: "SESSION", sessionId: session.id };
}

export type RecentSession = {
  id: string;
  className: string;
  categoryLabel: string;
  endedAt: Date;
  joined: boolean;
  /** Questions the room did that this student hasn't answered. */
  toCatchUp: number;
  /** Own questions missed or not reached, not yet retried. */
  toRetry: number;
};

/**
 * Recently ended sessions in this student's classes that still have
 * something for them: a catch-up or a question to retry. For the dashboard.
 */
export async function recentSessionsWithWork(studentId: string, now: Date = new Date()): Promise<RecentSession[]> {
  const sessions = await prisma.guidedSession.findMany({
    where: {
      status: "ENDED",
      endedAt: { gte: new Date(now.getTime() - CATCH_UP_DAYS * DAY_MS) },
      classroom: { archivedAt: null, enrollments: { some: { studentId, removedAt: null } } },
    },
    orderBy: { endedAt: "desc" },
    take: 5,
    select: {
      id: true,
      category: true,
      perStudentSkills: true,
      endedAt: true,
      classroom: { select: { name: true, enrollments: { where: { studentId, removedAt: null }, select: { joinedAt: true } } } },
      participants: { where: { studentId }, select: { id: true } },
      items: {
        where: {
          OR: [
            { kind: "WARMUP", revealedAt: { not: null } },
            { kind: { in: ["CLASS", "TWIN"] }, openedAt: { not: null } },
          ],
        },
        select: { id: true },
      },
      responses: {
        where: { studentId, OR: [{ firstAnswer: { not: null } }, { secondAnswer: { not: null } }] },
        select: { itemId: true },
      },
      ownSlots: { where: { studentId, retryAnswer: null, NOT: { isCorrect: true } }, select: { id: true } },
    },
  });
  return sessions
    .filter(wasInClassFor)
    .map((s) => {
      const answered = new Set(s.responses.map((r) => r.itemId));
      return {
        id: s.id,
        className: s.classroom.name,
        categoryLabel: sessionSkillLabel(s),
        endedAt: s.endedAt!,
        joined: s.participants.length > 0,
        toCatchUp: s.items.filter((i) => !answered.has(i.id)).length,
        toRetry: s.ownSlots.length,
      };
    })
    .filter((s) => s.toCatchUp > 0 || s.toRetry > 0);
}

/**
 * A session the student can owe work for: they took part, or they were already in the class when it
 * ended. One held before they joined the class is not one they "missed" (review, 2026-11-09: a new
 * student was told "Catch up: 4 questions from the session you missed" for a session from before
 * they signed up); Homework already treats work from before a student joined the same way.
 */
function wasInClassFor(s: { endedAt: Date | null; participants: unknown[]; classroom: { enrollments: { joinedAt: Date }[] } }): boolean {
  if (s.participants.length > 0) return true;
  const joinedAt = s.classroom.enrollments[0]?.joinedAt;
  return !!joinedAt && !!s.endedAt && joinedAt.getTime() <= s.endedAt.getTime();
}

/** Students in a class with an extended-time accommodation, for the teacher's class page. */
export async function classExtraTime(classroomId: string): Promise<Map<string, ExtraTime>> {
  const rows = await prisma.classroomEnrollment.findMany({
    where: { classroomId, removedAt: null, extraTime: { not: "NONE" } },
    select: { studentId: true, extraTime: true },
  });
  return new Map(rows.map((r) => [r.studentId, r.extraTime]));
}

export type SchoolGuidedTotals = { sessions: number; students: number; minutes: number };

/**
 * Guided Sessions at a school over a window, for its administrators and the
 * CCMR team: how many were run, how many students took part, and how much
 * class time. Totals only; never a result.
 */
export async function schoolGuidedTotals(schoolId: string, days: number, now: Date = new Date()): Promise<SchoolGuidedTotals> {
  return campusesGuidedTotals([schoolId], days, now);
}

/** The same totals across several campuses (a district's), each student counted once. */
export async function campusesGuidedTotals(schoolIds: string[], days: number, now: Date = new Date()): Promise<SchoolGuidedTotals> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const sessions = await prisma.guidedSession.findMany({
    where: { status: "ENDED", endedAt: { gte: since }, classroom: { schoolId: { in: schoolIds } } },
    select: { startedAt: true, endedAt: true, participants: { select: { studentId: true } } },
  });
  const students = new Set(sessions.flatMap((s) => s.participants.map((p) => p.studentId)));
  const minutes = sessions.reduce((sum, s) => {
    if (!s.startedAt || !s.endedAt) return sum;
    // A session left open overnight counts as the longest a real one runs.
    return sum + Math.min(90, Math.max(0, (s.endedAt.getTime() - s.startedAt.getTime()) / 60000));
  }, 0);
  return { sessions: sessions.length, students: students.size, minutes: Math.round(minutes) };
}

/**
 * The sessions a student took part in recently, newest first, for the list on /live (review,
 * 2026-11-09: a past session's recap opened only from the home page's latest card, so an earlier one
 * couldn't be reached at all).
 */
export async function pastSessionsForStudent(studentId: string, now: Date = new Date(), days = 60) {
  const sessions = await prisma.guidedSession.findMany({
    where: {
      status: "ENDED",
      endedAt: { gte: new Date(now.getTime() - days * DAY_MS) },
      OR: [{ participants: { some: { studentId } } }, { responses: { some: { studentId } } }],
    },
    orderBy: { endedAt: "desc" },
    take: 10,
    select: { id: true, category: true, perStudentSkills: true, endedAt: true, classroom: { select: { name: true } } },
  });
  return sessions.map((s) => ({ id: s.id, className: s.classroom.name, skill: sessionSkillLabel(s), endedAt: s.endedAt! }));
}

/** Homework set and finished in the last `days` days across these campuses (counts only). */
export async function campusesHomeworkTotals(schoolIds: string[], days: number, now: Date = new Date()) {
  const since = new Date(now.getTime() - days * DAY_MS);
  const [assigned, finished] = await Promise.all([
    prisma.assignment.count({ where: { createdAt: { gte: since }, classroom: { schoolId: { in: schoolIds } } } }),
    prisma.homeworkSession.count({ where: { completedAt: { gte: since }, assignment: { classroom: { schoolId: { in: schoolIds } } } } }),
  ]);
  return { assigned, finished };
}
