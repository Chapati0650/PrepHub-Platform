import type { AssignmentMode } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { GOAL_TIME_ZONE, endOfLocalDay, localDateInputValue } from "@/lib/community/local-day";
import {
  HOMEWORK_NUDGE_COOLDOWN_HOURS,
  HOMEWORK_REMINDER_MIN_AGE_HOURS,
  HOMEWORK_REMINDER_WINDOW_HOURS,
} from "./config";
import { teacherName } from "./names";

/**
 * The homework emails (Owner, 2026-10-31): one to each student when homework
 * is assigned, and one the day before it's due to each student who hasn't
 * finished it — plus (2026-11-01) the teacher's own "Remind the N who haven't
 * finished", sent whenever they press it. All go through the outbound email
 * queue, so a class of thirty is thirty rows written in one transaction and
 * delivered by the queue, never a send loop inside the teacher's request.
 *
 * Plain text, like every PrepHub email. Stored bodies stay within WIN1252
 * (the local database's encoding; see CLAUDE.md "Scale readiness").
 */

export const HOMEWORK_ASSIGNED_KIND = "homework-assigned";
export const HOMEWORK_REMINDER_KIND = "homework-reminder";
export const HOMEWORK_NUDGE_KIND = "homework-nudge";

const SITE = process.env.NEXTAUTH_URL ?? "https://prephubtp.com";
const HOUR_MS = 60 * 60 * 1000;

type QueuedRow = { kind: string; to: string; subject: string; body: string };

/** "Friday, Nov 6", in the school's zone. */
function dueDay(dueAt: Date): string {
  return dueAt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: GOAL_TIME_ZONE });
}

function footer(className: string): string {
  return `You're getting this because you're in ${className} on PrepHub.`;
}

export type AssignedEmailInput = {
  student: { email: string; firstName: string };
  teacher: string;
  className: string;
  title: string;
  questionCount: number;
  dueAt: Date | null;
  mode: AssignmentMode;
  assignmentId: string;
};

export function homeworkAssignedMessage(input: AssignedEmailInput): QueuedRow {
  const { student, teacher, className, title, questionCount, dueAt, mode, assignmentId } = input;
  const size = `${questionCount} question${questionCount === 1 ? "" : "s"}`;
  const lines = [
    `Hi ${student.firstName},`,
    "",
    `${teacher} assigned new homework in ${className}:`,
    "",
    title,
    `${size}${dueAt ? `, due ${dueDay(dueAt)}` : ""}.`,
    ...(mode === "QUIZ" ? ["It's a quiz: you'll see which ones you got right after you turn it in."] : []),
    "",
    `Start it here: ${SITE}/homework/${assignmentId}`,
    "",
    "- PrepHub",
    "",
    footer(className),
  ];
  return {
    kind: HOMEWORK_ASSIGNED_KIND,
    to: student.email,
    subject: `New homework from ${teacher}: ${title}`,
    body: lines.join("\n"),
  };
}

export type ReminderEmailInput = {
  student: { email: string; firstName: string };
  className: string;
  title: string;
  questionCount: number;
  /** Questions this student has already answered. */
  answered: number;
  dueAt: Date;
  assignmentId: string;
  now: Date;
};

export function homeworkReminderMessage(input: ReminderEmailInput): QueuedRow {
  const { student, className, title, questionCount, answered, dueAt, assignmentId, now } = input;
  // Due at the very end of its day, so the day it's due on is the day of the
  // moment just before.
  const tonight = localDateInputValue(new Date(dueAt.getTime() - 1)) === localDateInputValue(now);
  const when = tonight ? "tonight" : "tomorrow";
  return {
    kind: HOMEWORK_REMINDER_KIND,
    to: student.email,
    subject: `Due ${when}: ${title}`,
    body: [
      `Hi ${student.firstName},`,
      "",
      `Your ${className} homework, "${title}", is due ${when} (${dueDay(dueAt)}).`,
      progressLine(answered, questionCount),
      `${SITE}/homework/${assignmentId}`,
      "",
      "- PrepHub",
      "",
      footer(className),
    ].join("\n"),
  };
}

function progressLine(answered: number, questionCount: number): string {
  return answered > 0
    ? `You've answered ${answered} of ${questionCount}. Finish it here:`
    : `It's ${questionCount} question${questionCount === 1 ? "" : "s"}. Start it here:`;
}

export type NudgeEmailInput = Omit<ReminderEmailInput, "dueAt"> & {
  /** As the class knows them: "Ms. Alvarez". */
  teacher: string;
  dueAt: Date | null;
};

/**
 * Where the deadline stands on the day the teacher presses the button. The
 * day-before reminder can say "due tomorrow" because the cron only sends it
 * then; a teacher's reminder can go a week early or the morning after, and a
 * past-due one that said "tomorrow" would be wrong in a way students notice.
 */
function deadlineLine(teacher: string, dueAt: Date | null, now: Date): { sentence: string | null; pastDue: boolean } {
  if (!dueAt) return { sentence: null, pastDue: false };
  if (dueAt <= now) {
    return {
      sentence: `It was due ${dueDay(dueAt)}. ${teacher} still accepts it - it will be marked late.`,
      pastDue: true,
    };
  }
  // Due at the very end of its day, so the day it's due on is the day of the
  // moment just before.
  const dueOn = localDateInputValue(new Date(dueAt.getTime() - 1));
  const today = localDateInputValue(now);
  const endOfToday = endOfLocalDay(today);
  const tomorrow = endOfToday ? localDateInputValue(new Date(endOfToday.getTime() + 1)) : null;
  if (dueOn === today) return { sentence: "It's due tonight.", pastDue: false };
  if (dueOn === tomorrow) return { sentence: `It's due tomorrow (${dueDay(dueAt)}).`, pastDue: false };
  return { sentence: `It's due ${dueDay(dueAt)}.`, pastDue: false };
}

/** The teacher's "Remind the N who haven't finished", for one student. */
export function homeworkNudgeMessage(input: NudgeEmailInput): QueuedRow {
  const { student, teacher, className, title, questionCount, answered, dueAt, assignmentId, now } = input;
  const deadline = deadlineLine(teacher, dueAt, now);
  return {
    kind: HOMEWORK_NUDGE_KIND,
    to: student.email,
    subject: deadline.pastDue ? `Past due: ${title}` : `Reminder from ${teacher}: ${title}`,
    body: [
      `Hi ${student.firstName},`,
      "",
      `${teacher} sent a reminder about your ${className} homework, "${title}".`,
      ...(deadline.sentence ? [deadline.sentence] : []),
      progressLine(answered, questionCount),
      `${SITE}/homework/${assignmentId}`,
      "",
      "- PrepHub",
      "",
      footer(className),
    ].join("\n"),
  };
}

/**
 * Who a teacher's reminder goes to: on the roster now, not turned in, and not
 * someone who joined after it was due — for them it's optional, and an email
 * calling it past due would be wrong. One rule for the count on the button
 * and for the list the email is sent to, so the two can't disagree.
 */
export function needsNudge(student: { enrolled: boolean; completed: boolean; joinedLater: boolean }): boolean {
  return student.enrolled && !student.completed && !student.joinedLater;
}

/** When the next teacher's reminder may go, or null if it can go now. */
export function nudgeAvailableAt(lastNudgedAt: Date | null, now: Date): Date | null {
  if (!lastNudgedAt) return null;
  const next = new Date(lastNudgedAt.getTime() + HOMEWORK_NUDGE_COOLDOWN_HOURS * HOUR_MS);
  return next > now ? next : null;
}

/** "Nov 2, 3:15 PM", in the school's zone — for the teacher's screen, never a stored email. */
export function formatNudgeTime(at: Date): string {
  return at.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: GOAL_TIME_ZONE,
  });
}

/**
 * Whether today's run should remind students about this homework: open, due
 * within the window, and not assigned so recently that its students were
 * only just told about it.
 */
export function reminderDue(
  a: { dueAt: Date | null; createdAt: Date; closedAt: Date | null; reminderQueuedAt: Date | null },
  now: Date,
): boolean {
  if (!a.dueAt || a.closedAt || a.reminderQueuedAt) return false;
  const untilDue = a.dueAt.getTime() - now.getTime();
  if (untilDue <= 0 || untilDue > HOMEWORK_REMINDER_WINDOW_HOURS * HOUR_MS) return false;
  return now.getTime() - a.createdAt.getTime() >= HOMEWORK_REMINDER_MIN_AGE_HOURS * HOUR_MS;
}

/**
 * The daily run's homework job. Each assignment is claimed (its
 * reminderQueuedAt set, guarded on still being null) in the same transaction
 * that queues its emails, so a re-run, or two runs at once, remind a class
 * exactly once. Returns how many emails were queued.
 */
export async function queueHomeworkReminders(now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + HOMEWORK_REMINDER_WINDOW_HOURS * HOUR_MS);
  const candidates = await prisma.assignment.findMany({
    where: {
      closedAt: null,
      reminderQueuedAt: null,
      dueAt: { gt: now, lte: horizon },
      classroom: { archivedAt: null },
    },
    select: {
      id: true,
      title: true,
      dueAt: true,
      createdAt: true,
      closedAt: true,
      reminderQueuedAt: true,
      _count: { select: { questions: true } },
      classroom: {
        select: {
          name: true,
          enrollments: {
            where: { removedAt: null, student: { role: "STUDENT", deletedAt: null } },
            select: { student: { select: { id: true, email: true, firstName: true } } },
          },
        },
      },
      sessions: {
        select: { studentId: true, status: true, _count: { select: { slots: { where: { finalizedAt: { not: null } } } } } },
      },
    },
  });

  let queued = 0;
  for (const a of candidates) {
    if (!reminderDue(a, now) || !a.dueAt) continue;
    const sessionByStudent = new Map(a.sessions.map((s) => [s.studentId, s]));
    const rows = a.classroom.enrollments
      .map((e) => e.student)
      .filter((s) => sessionByStudent.get(s.id)?.status !== "COMPLETED")
      .map((s) =>
        homeworkReminderMessage({
          student: s,
          className: a.classroom.name,
          title: a.title,
          questionCount: a._count.questions,
          answered: sessionByStudent.get(s.id)?._count.slots ?? 0,
          dueAt: a.dueAt!,
          assignmentId: a.id,
          now,
        }),
      );
    const wrote = await prisma.$transaction(async (tx) => {
      const claim = await tx.assignment.updateMany({ where: { id: a.id, reminderQueuedAt: null }, data: { reminderQueuedAt: now } });
      if (claim.count === 0) return 0;
      if (rows.length > 0) await tx.queuedEmail.createMany({ data: rows });
      return rows.length;
    });
    queued += wrote;
  }
  return queued;
}

/** The assigned-homework email rows for one assignment, for its creating transaction. */
export function assignedEmailRows(
  assignment: Omit<AssignedEmailInput, "student" | "teacher"> & { teacher: { firstName: string; teacherDisplayName: string | null } },
  students: { email: string; firstName: string }[],
): QueuedRow[] {
  const teacher = teacherName(assignment.teacher);
  return students.map((student) => homeworkAssignedMessage({ ...assignment, teacher, student }));
}
