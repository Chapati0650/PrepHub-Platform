import { describe, expect, it } from "vitest";
import { gradebookCell, gradebookRows, homeworkOwed, submissionsByKey } from "./gradebook-export";
import type { ClassroomDetail } from "./classrooms";

const day = (iso: string) => new Date(iso);
const now = day("2026-11-10T18:00:00Z");

const assignment = (id: string, title: string, created: string, due: string | null, questionCount = 10) => ({
  id,
  title,
  dueAt: due ? day(due) : null,
  closedAt: null,
  closed: false,
  mode: "PRACTICE" as const,
  createdAt: day(created),
  questionCount,
  completed: 0,
  inProgress: 0,
  expected: 0,
  averagePercent: null,
});

const done = (studentId: string, assignmentId: string, correct: number, late = false) => ({
  studentId,
  assignmentId,
  status: "COMPLETED" as const,
  correct,
  completedAt: day("2026-11-04"),
  late,
});

const detail: ClassroomDetail = {
  id: "c1",
  name: "1st Period",
  joinCode: "ABCDEF",
  archived: false,
  // Newest first, as the class page lists them.
  assignments: [
    assignment("a2", "Transitions", "2026-11-05T00:00:00Z", "2026-11-20T05:59:59Z"),
    assignment("a1", "Linear equations", "2026-11-01T00:00:00Z", "2026-11-06T05:59:59Z"),
  ],
  students: [
    { studentId: "s1", firstName: "Mason", lastName: "Ortiz", email: "m.ortiz@school.org", joinedAt: day("2026-10-01"), completedAssignments: 1 },
    { studentId: "s2", firstName: "Mason", lastName: "Tran", email: "m.tran@school.org", joinedAt: day("2026-10-01"), completedAssignments: 0 },
    { studentId: "s3", firstName: "Ana", lastName: null, email: "ana@school.org", joinedAt: day("2026-11-08"), completedAssignments: 0 },
  ],
  formerStudents: [
    {
      studentId: "s4",
      firstName: "Dee",
      lastName: "Young",
      email: "dee@school.org",
      joinedAt: day("2026-10-01"),
      completedAssignments: 1,
      leftAt: day("2026-11-08T18:00:00Z"),
    },
  ],
  submissions: [
    done("s1", "a1", 7, true),
    { studentId: "s2", assignmentId: "a2", status: "IN_PROGRESS", correct: 2, completedAt: null, late: false },
    done("s4", "a1", 9),
  ],
};

describe("gradebookRows", () => {
  it("lists homework oldest first, with percentages a spreadsheet won't mistake for dates", () => {
    const [header, ortiz, tran, ana] = gradebookRows(detail, now);
    expect(header).toEqual([
      "Last name",
      "First name",
      "Email",
      "Linear equations (% correct, due Nov 5)",
      "Transitions (% correct, due Nov 19)",
      "Homework finished",
      "Turned in late",
      "Note",
    ]);
    // Late work keeps a plain number in its column, and is named in its own.
    expect(ortiz).toEqual(["Ortiz", "Mason", "m.ortiz@school.org", "70", "", "1", "Linear equations", ""]);
    // Past due and never started: Missing. Started and not finished: Started.
    expect(tran).toEqual(["Tran", "Mason", "m.tran@school.org", "Missing", "Started", "0", "", ""]);
    // Joined after the first homework was due: never held against them.
    expect(ana).toEqual(["", "Ana", "ana@school.org", "Joined later", "", "0", "", ""]);
  });

  it("keeps a student who left after doing work, after everyone else, marked as having left and never Missing", () => {
    const rows = gradebookRows(detail, now);
    expect(rows).toHaveLength(5);
    expect(rows[4]).toEqual(["Young", "Dee", "dee@school.org", "90", "", "1", "", "Left the class Nov 8"]);
  });
});

describe("gradebookCell", () => {
  const [a2, a1] = detail.assignments;
  const results = submissionsByKey(detail);

  it("carries lateness on a score rather than in place of it", () => {
    expect(gradebookCell(detail.students[0], a1, results.get("s1:a1"), now)).toEqual({
      kind: "score",
      correct: 7,
      total: 10,
      percent: 70,
      late: true,
    });
  });

  it("says Missing only once it's due, and nothing for a student who has left", () => {
    expect(gradebookCell(detail.students[1], a1, undefined, now)).toEqual({ kind: "missing" });
    expect(gradebookCell(detail.students[1], a2, undefined, day("2026-11-06T00:00:00Z"))).toEqual({ kind: "notStarted" });
    expect(gradebookCell(detail.formerStudents[0], a2, undefined, now, { left: true })).toEqual({ kind: "notStarted" });
  });
});

describe("homeworkOwed", () => {
  const results = submissionsByKey(detail);

  it("counts homework that's due or closed, not homework due next week", () => {
    // Tran: Linear equations is past due; Transitions isn't due until the 19th.
    expect(homeworkOwed(detail.students[1], detail.assignments, results, now)).toBe(1);
  });

  it("counts anything finished whatever its date, so done never exceeds owed", () => {
    const early = submissionsByKey({ submissions: [done("s2", "a2", 8)] });
    expect(homeworkOwed(detail.students[1], detail.assignments, early, now)).toBe(2);
  });

  it("leaves out homework already due when the student joined", () => {
    expect(homeworkOwed(detail.students[2], detail.assignments, results, now)).toBe(0);
  });

  it("counts closed homework with no due date as owed", () => {
    const closed = { ...assignment("a3", "Closed one", "2026-11-02T00:00:00Z", null), closedAt: day("2026-11-09"), closed: true };
    expect(homeworkOwed(detail.students[1], [closed], results, now)).toBe(1);
  });
});
