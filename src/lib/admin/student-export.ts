import { prisma } from "@/lib/prisma";
import { emptyStudentActivity, getStudentActivity, type StudentActivity } from "@/lib/school/student-activity";

// The Students page as a spreadsheet (2026-10-25). An administrator lives in
// Excel and Google Sheets: sorting the list by last-active, or pasting the
// students who haven't started into an email to counselors, is a thing they
// already know how to do, and a download lets them.
//
// Exactly the directory's fields and nothing more — engagement, never
// performance (see student-directory.ts). No correctness, ability or
// predicted-score field is selected here either.

const STATUS_LABELS: Record<string, string> = { ACTIVE: "Active", REMOVED: "Removed", GRADUATED: "Graduated" };

const HEADER = [
  "First name",
  "School email",
  "Class of",
  "Status",
  "Questions answered",
  "Sessions finished",
  "Study hours",
  "Signed up",
  "Last active",
];

function isoDay(date: Date | null): string {
  return date ? new Date(date).toISOString().slice(0, 10) : "";
}

/**
 * Students per activity query. `getStudentActivity` binds each id once per
 * answer and session table — thirteen times — and Postgres refuses a query
 * with more than 65,535 parameters, so one query over a whole school failed
 * at about 5,000 students with a bare 500. A school's export is every student
 * it has ever had, so it is read a slice at a time.
 */
export const EXPORT_ACTIVITY_CHUNK = 500;

async function activityInChunks(studentIds: string[]): Promise<Map<string, StudentActivity>> {
  const all = new Map<string, StudentActivity>();
  for (let i = 0; i < studentIds.length; i += EXPORT_ACTIVITY_CHUNK) {
    const chunk = await getStudentActivity(studentIds.slice(i, i + EXPORT_ACTIVITY_CHUNK));
    for (const [id, a] of chunk) all.set(id, a);
  }
  return all;
}

export async function getStudentExportRows(schoolId: string): Promise<string[][]> {
  const memberships = await prisma.studentMembership.findMany({
    where: { schoolId },
    orderBy: [{ student: { firstName: "asc" } }],
    select: {
      studentId: true,
      verifiedSchoolEmail: true,
      expectedGraduationYear: true,
      status: true,
      activatedAt: true,
      student: { select: { firstName: true } },
    },
  });
  const activity = await activityInChunks(memberships.map((m) => m.studentId));

  return [
    HEADER,
    ...memberships.map((m) => {
      const a = activity.get(m.studentId) ?? emptyStudentActivity();
      return [
        m.student.firstName,
        m.verifiedSchoolEmail,
        String(m.expectedGraduationYear),
        STATUS_LABELS[m.status] ?? m.status,
        String(a.questionsAnswered),
        String(a.sessionsCompleted),
        String(Math.round(a.studyHours * 10) / 10),
        isoDay(m.activatedAt),
        isoDay(a.lastActiveAt),
      ];
    }),
  ];
}

/**
 * Rows to CSV text that opens cleanly in Excel and Google Sheets.
 *
 * Quotes any cell holding a comma, quote or line break, and defuses a cell a
 * spreadsheet would run as a formula (one starting with =, +, -, @, tab or
 * carriage return) by prefixing an apostrophe: a student's first name is
 * typed by the student, and "=HYPERLINK(...)" is a valid one.
 */
export function toCsv(rows: string[][]): string {
  const cell = (raw: string) => {
    const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  // A byte-order mark so Excel reads accented names as UTF-8, and CRLF line
  // ends, which is what the CSV standard and Excel both expect.
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
