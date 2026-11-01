import { formatGoalDate } from "@/lib/community/local-day";
import type { ClassroomDetail, ClassroomStudent } from "./classrooms";
import { joinedAfterDeadline } from "./deadline";

type Assignment = ClassroomDetail["assignments"][number];
type Submission = ClassroomDetail["submissions"][number];

/**
 * What one gradebook cell says, decided once for the class page and the
 * download so the two can never disagree.
 *
 * A student who has left the class is never "Missing" or "Joined later":
 * they're listed for the work they did, and what they didn't do is no longer
 * owed.
 */
export type GradebookCell =
  | { kind: "score"; correct: number; total: number; percent: number | null; late: boolean }
  | { kind: "started" }
  | { kind: "missing" }
  | { kind: "joinedLater" }
  | { kind: "notStarted" };

/** Due date passed, or closed: the homework is owed now. */
export function isPastDue(assignment: Pick<Assignment, "dueAt" | "closed">, now: Date): boolean {
  return assignment.closed || (assignment.dueAt !== null && assignment.dueAt < now);
}

export function gradebookCell(
  student: Pick<ClassroomStudent, "joinedAt">,
  assignment: Assignment,
  submission: Submission | undefined,
  now: Date,
  { left = false }: { left?: boolean } = {},
): GradebookCell {
  if (submission?.status === "COMPLETED") {
    const total = assignment.questionCount;
    return {
      kind: "score",
      correct: submission.correct,
      total,
      percent: total > 0 ? Math.round((submission.correct / total) * 100) : null,
      late: submission.late,
    };
  }
  if (submission) return { kind: "started" };
  if (left) return { kind: "notStarted" };
  // Already due (or closed) when they joined: never "Missing".
  if (joinedAfterDeadline(student.joinedAt, assignment)) return { kind: "joinedLater" };
  return isPastDue(assignment, now) ? { kind: "missing" } : { kind: "notStarted" };
}

/**
 * The "of" in a student's "Finished 2 of 3": the homework that's due or closed
 * and was set while they were in the class, plus anything they've finished
 * whatever its date. Homework due next week isn't owed yet, so a student
 * doesn't read "2 of 5" for three things they still have time to do; and
 * "done" can never exceed "of".
 */
export function homeworkOwed(
  student: Pick<ClassroomStudent, "studentId" | "joinedAt">,
  assignments: Assignment[],
  results: Map<string, Submission>,
  now: Date,
): number {
  return assignments.filter((a) => {
    if (results.get(submissionKey(student.studentId, a.id))?.status === "COMPLETED") return true;
    return isPastDue(a, now) && !joinedAfterDeadline(student.joinedAt, a);
  }).length;
}

export function submissionKey(studentId: string, assignmentId: string): string {
  return `${studentId}:${assignmentId}`;
}

export function submissionsByKey(detail: Pick<ClassroomDetail, "submissions">): Map<string, Submission> {
  return new Map(detail.submissions.map((s) => [submissionKey(s.studentId, s.assignmentId), s]));
}

/**
 * A class's gradebook as spreadsheet rows, for "Download gradebook". Teachers
 * keep grades in the school's own system (Skyward, PowerSchool, Google
 * Classroom), so this is what they copy from.
 *
 * Scores are percentages, as plain numbers: "7/10" would be read by Excel as
 * the 10th of July, and "85 (late)" would stop a column summing. So lateness
 * gets its own trailing column naming the homework turned in late, and
 * students who have left the class come after everyone else with a note
 * saying so — their finished work is still a grade to record. The same
 * statuses as the class page otherwise (gradebookCell). Homework runs oldest
 * first, the way a gradebook reads.
 */
export function gradebookRows(detail: ClassroomDetail, now: Date): string[][] {
  const assignments = [...detail.assignments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const results = submissionsByKey(detail);

  const header = [
    "Last name",
    "First name",
    "Email",
    ...assignments.map((a) => `${a.title} (% correct${a.dueAt ? `, due ${formatGoalDate(a.dueAt)}` : ""})`),
    "Homework finished",
    "Turned in late",
    "Note",
  ];

  const row = (s: ClassroomStudent, note: string, left: boolean) => {
    const cells = assignments.map((a) => gradebookCell(s, a, results.get(submissionKey(s.studentId, a.id)), now, { left }));
    return [
      s.lastName ?? "",
      s.firstName,
      s.email,
      ...cells.map((c) => {
        switch (c.kind) {
          case "score":
            return c.percent === null ? "" : String(c.percent);
          case "started":
            return "Started";
          case "joinedLater":
            return "Joined later";
          case "missing":
            return "Missing";
          case "notStarted":
            return "";
        }
      }),
      String(s.completedAssignments),
      assignments
        .filter((_, i) => {
          const cell = cells[i];
          return cell.kind === "score" && cell.late;
        })
        .map((a) => a.title)
        .join("; "),
      note,
    ];
  };

  return [
    header,
    ...detail.students.map((s) => row(s, "", false)),
    ...detail.formerStudents.map((s) => row(s, `Left the class ${formatGoalDate(s.leftAt)}`, true)),
  ];
}
