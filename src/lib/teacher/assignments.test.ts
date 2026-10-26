import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createAssignment, deleteAssignment, getAssignmentResults } from "@/lib/teacher/assignments";
import type { TeacherContext } from "@/lib/teacher/access";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    classroom: { findUnique: vi.fn() },
    assignment: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    question: { findMany: vi.fn() },
    assignmentQuestion: { findMany: vi.fn() },
    classroomEnrollment: { findMany: vi.fn() },
    homeworkSession: { findMany: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logUnauthorizedAccess: vi.fn() }));

const mocked = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const teacher: TeacherContext = { userId: "t1", firstName: "Ms. R", schoolId: "school1", schoolName: "Northwest HS" };
const NOW = new Date("2026-11-01T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocked.classroom.findUnique.mockResolvedValue({ id: "c1", teacherId: "t1", schoolId: "school1", archivedAt: null });
  mocked.assignment.create.mockResolvedValue({ id: "a1" });
});

describe("createAssignment", () => {
  it("refuses another teacher's class as not found", async () => {
    mocked.classroom.findUnique.mockResolvedValue({ id: "c1", teacherId: "someone-else", schoolId: "school1", archivedAt: null });
    await expect(
      createAssignment(teacher, "c1", { title: "HW", instructions: null, dueAt: null, questionIds: ["q1"] }, NOW),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses an archived class", async () => {
    mocked.classroom.findUnique.mockResolvedValue({ id: "c1", teacherId: "t1", schoolId: "school1", archivedAt: new Date() });
    await expect(
      createAssignment(teacher, "c1", { title: "HW", instructions: null, dueAt: null, questionIds: ["q1"] }, NOW),
    ).rejects.toMatchObject({ code: "CLASS_CLOSED" });
  });

  it("needs a title, at least one question, and a due date that hasn't passed", async () => {
    await expect(createAssignment(teacher, "c1", { title: "  ", instructions: null, dueAt: null, questionIds: ["q1"] }, NOW)).rejects.toThrow("title");
    await expect(createAssignment(teacher, "c1", { title: "HW", instructions: null, dueAt: null, questionIds: [] }, NOW)).rejects.toThrow("at least one");
    await expect(
      createAssignment(teacher, "c1", { title: "HW", instructions: null, dueAt: new Date(NOW.getTime() - 1), questionIds: ["q1"] }, NOW),
    ).rejects.toThrow("hasn't passed");
  });

  it("caps the number of questions", async () => {
    const ids = Array.from({ length: 31 }, (_, i) => `q${i}`);
    await expect(createAssignment(teacher, "c1", { title: "HW", instructions: null, dueAt: null, questionIds: ids }, NOW)).rejects.toThrow("up to 30");
  });

  it("refuses a question that's no longer published, and says how many", async () => {
    mocked.question.findMany.mockResolvedValue([{ id: "q1", currentPublishedRevisionId: "r1" }]);
    await expect(
      createAssignment(teacher, "c1", { title: "HW", instructions: null, dueAt: null, questionIds: ["q1", "q2"] }, NOW),
    ).rejects.toThrow("One question is no longer available");
    expect(mocked.assignment.create).not.toHaveBeenCalled();
  });

  it("pins each question to its published revision, in the teacher's order, without duplicates", async () => {
    mocked.question.findMany.mockResolvedValue([
      { id: "q1", currentPublishedRevisionId: "r1" },
      { id: "q2", currentPublishedRevisionId: "r2" },
    ]);

    await createAssignment(teacher, "c1", { title: "  Warm  up ", instructions: " ", dueAt: null, questionIds: ["q2", "q1", "q2"] }, NOW);

    const data = mocked.assignment.create.mock.calls[0][0].data;
    expect(data.title).toBe("Warm up");
    expect(data.instructions).toBeNull();
    expect(data.questions.create).toEqual([
      { position: 0, questionId: "q2", questionRevisionId: "r2" },
      { position: 1, questionId: "q1", questionRevisionId: "r1" },
    ]);
  });
});

describe("deleteAssignment", () => {
  it("only deletes homework nobody has started", async () => {
    mocked.assignment.findUnique.mockResolvedValue({ id: "a1", classroom: { id: "c1", teacherId: "t1", schoolId: "school1" } });
    mocked.homeworkSession.count.mockResolvedValue(1);
    await expect(deleteAssignment(teacher, "a1")).rejects.toMatchObject({ code: "HAS_WORK" });
    expect(mocked.assignment.delete).not.toHaveBeenCalled();
  });
});

describe("getAssignmentResults", () => {
  it("reports each student's status and score, keeps a removed student's finished work, and marks late work", async () => {
    const due = new Date("2026-11-05T05:59:59Z");
    mocked.assignment.findUnique.mockResolvedValue({
      id: "a1",
      title: "HW",
      instructions: null,
      dueAt: due,
      closedAt: null,
      createdAt: new Date("2026-11-01"),
      classroomId: "c1",
      classroom: { id: "c1", name: "3rd period", teacherId: "t1", schoolId: "school1" },
    });
    mocked.assignmentQuestion.findMany.mockResolvedValue([
      { position: 0, questionId: "q1", question: { category: "ALGEBRA", difficulty: "EASY", questionType: "MULTIPLE_CHOICE" } },
      { position: 1, questionId: "q2", question: { category: "ALGEBRA", difficulty: "HARD", questionType: "MULTIPLE_CHOICE" } },
    ]);
    const joined = new Date("2026-10-01");
    mocked.classroomEnrollment.findMany.mockResolvedValue([
      { joinedAt: joined, removedAt: null, student: { id: "ada", firstName: "Ada", email: "ada@x.org" } },
      { joinedAt: joined, removedAt: null, student: { id: "ben", firstName: "Ben", email: "ben@x.org" } },
      { joinedAt: joined, removedAt: null, student: { id: "cy", firstName: "Cy", email: "cy@x.org" } },
      { joinedAt: joined, removedAt: new Date("2026-11-07"), student: { id: "dee", firstName: "Dee", email: "dee@x.org" } },
    ]);
    const answered = new Date("2026-11-03");
    mocked.homeworkSession.findMany.mockResolvedValue([
      {
        studentId: "ada",
        status: "COMPLETED",
        completedAt: new Date("2026-11-04"),
        student: { firstName: "Ada", email: "ada@x.org" },
        slots: [
          { position: 0, isCorrect: true, finalizedAt: answered },
          { position: 1, isCorrect: true, finalizedAt: answered },
        ],
      },
      {
        studentId: "ben",
        status: "ACTIVE",
        completedAt: null,
        student: { firstName: "Ben", email: "ben@x.org" },
        slots: [
          { position: 0, isCorrect: false, finalizedAt: answered },
          { position: 1, isCorrect: null, finalizedAt: null },
        ],
      },
      {
        // Left the class after finishing, late.
        studentId: "dee",
        status: "COMPLETED",
        completedAt: new Date("2026-11-06"),
        student: { firstName: "Dee", email: "dee@x.org" },
        slots: [
          { position: 0, isCorrect: true, finalizedAt: answered },
          { position: 1, isCorrect: false, finalizedAt: answered },
        ],
      },
    ]);

    const r = await getAssignmentResults(teacher, "a1");

    expect(r.students.map((s) => [s.firstName, s.status])).toEqual([
      ["Ada", "COMPLETED"],
      ["Dee", "COMPLETED"],
      ["Ben", "IN_PROGRESS"],
      ["Cy", "NOT_STARTED"],
    ]);
    const dee = r.students.find((s) => s.studentId === "dee")!;
    expect(dee).toMatchObject({ enrolled: false, late: true, correct: 1, missed: [1] });
    expect(r.students.find((s) => s.studentId === "ada")).toMatchObject({ late: false, correct: 2, missed: [] });
    expect(r.questions.map((q) => [q.answered, q.correct])).toEqual([
      [3, 2],
      [2, 1],
    ]);
    // "Of the class" is the current roster: Dee's finished work is counted on
    // its own, never as one of three, and the average is Ada's alone.
    expect(r.summary).toEqual({
      roster: 3,
      completed: 1,
      inProgress: 1,
      notStarted: 1,
      joinedLater: 0,
      leftCompleted: 1,
      averagePercent: 100,
    });
  });

  it("counts a student who joined after it was due as joined later, never missing or late", async () => {
    const due = new Date("2026-11-05T05:59:59Z");
    mocked.assignment.findUnique.mockResolvedValue({
      id: "a1",
      title: "HW",
      instructions: null,
      dueAt: due,
      closedAt: null,
      createdAt: new Date("2026-11-01"),
      classroomId: "c1",
      classroom: { id: "c1", name: "3rd period", teacherId: "t1", schoolId: "school1" },
    });
    mocked.assignmentQuestion.findMany.mockResolvedValue([
      { position: 0, questionId: "q1", question: { category: "ALGEBRA", difficulty: "EASY", questionType: "MULTIPLE_CHOICE" } },
    ]);
    const before = new Date("2026-10-01");
    const after = new Date("2026-11-08");
    mocked.classroomEnrollment.findMany.mockResolvedValue([
      { joinedAt: before, removedAt: null, student: { id: "ada", firstName: "Ada", email: "ada@x.org" } },
      { joinedAt: after, removedAt: null, student: { id: "eve", firstName: "Eve", email: "eve@x.org" } },
      { joinedAt: after, removedAt: null, student: { id: "fay", firstName: "Fay", email: "fay@x.org" } },
    ]);
    mocked.homeworkSession.findMany.mockResolvedValue([
      {
        // Joined after the due date and did it anyway.
        studentId: "fay",
        status: "COMPLETED",
        completedAt: new Date("2026-11-09"),
        student: { firstName: "Fay", email: "fay@x.org" },
        slots: [{ position: 0, isCorrect: true, finalizedAt: new Date("2026-11-09") }],
      },
    ]);

    const r = await getAssignmentResults(teacher, "a1");

    expect(r.students.map((s) => [s.firstName, s.status, s.joinedLater])).toEqual([
      ["Fay", "COMPLETED", true],
      ["Ada", "NOT_STARTED", false],
      ["Eve", "NOT_STARTED", true],
    ]);
    expect(r.students.find((s) => s.studentId === "fay")!.late).toBe(false);
    expect(r.summary).toMatchObject({ roster: 3, completed: 1, inProgress: 0, notStarted: 1, joinedLater: 1 });
  });

  it("won't show another teacher's assignment", async () => {
    mocked.assignment.findUnique.mockResolvedValue({ id: "a1", classroom: { id: "c1", teacherId: "someone-else", schoolId: "school1" } });
    await expect(getAssignmentResults(teacher, "a1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocked.homeworkSession.findMany).not.toHaveBeenCalled();
  });
});
