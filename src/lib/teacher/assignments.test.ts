import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  assignToMoreClasses,
  createAssignment,
  createAssignments,
  deleteAssignment,
  getAssignmentResults,
  remindUnfinished,
  updateAssignment,
} from "@/lib/teacher/assignments";
import { endOfLocalDay } from "@/lib/community/local-day";
import type { TeacherContext } from "@/lib/teacher/access";

vi.mock("@/lib/prisma", () => {
  const mock: Record<string, unknown> = {
    classroom: { findUnique: vi.fn() },
    assignment: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    question: { findMany: vi.fn() },
    assignmentQuestion: { findMany: vi.fn(), count: vi.fn() },
    classroomEnrollment: { findMany: vi.fn() },
    homeworkSession: { findMany: vi.fn(), count: vi.fn() },
    queuedEmail: { createMany: vi.fn() },
  };
  mock.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(mock));
  return { prisma: mock };
});
vi.mock("@/lib/email-queue", () => ({ drainForRequest: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logUnauthorizedAccess: vi.fn() }));

const mocked = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const teacher: TeacherContext = {
  userId: "t1",
  firstName: "Rosa",
  teacherDisplayName: "Ms. R",
  schoolId: "school1",
  schoolName: "Northwest HS",
};
const NOW = new Date("2026-11-01T12:00:00Z");

/** An assignment question with its answer key: choices k0..k3, the correct one at `correct`. */
function assigned(position: number, questionId: string, difficulty: string, correct = 1) {
  return {
    position,
    questionId,
    question: { category: "ALGEBRA", difficulty, questionType: "MULTIPLE_CHOICE" },
    questionRevision: {
      acceptedAnswers: [],
      answerChoices: [0, 1, 2, 3].map((i) => ({ id: `${questionId}-k${i}`, isCorrect: i === correct })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.classroom.findUnique.mockResolvedValue({ id: "c1", name: "1st period", teacherId: "t1", schoolId: "school1", archivedAt: null });
  mocked.assignment.create.mockResolvedValue({ id: "a1" });
  mocked.classroomEnrollment.findMany.mockResolvedValue([]);
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
    expect(data.mode).toBe("PRACTICE");
    expect(data.questions.create).toEqual([
      { position: 0, questionId: "q2", questionRevisionId: "r2" },
      { position: 1, questionId: "q1", questionRevisionId: "r1" },
    ]);
  });
});

describe("createAssignments", () => {
  beforeEach(() => {
    mocked.question.findMany.mockResolvedValue([{ id: "q1", currentPublishedRevisionId: "r1" }]);
    mocked.classroom.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, name: `Class ${where.id}`, teacherId: "t1", schoolId: "school1", archivedAt: null }),
    );
    mocked.assignment.create.mockImplementation(({ data }: { data: { classroomId: string } }) =>
      Promise.resolve({ id: `a-${data.classroomId}` }),
    );
  });

  it("gives each class its own copy and emails every student in each, naming the teacher as the class knows them", async () => {
    mocked.classroomEnrollment.findMany.mockResolvedValue([
      { classroomId: "c1", student: { email: "ana@x.org", firstName: "Ana" } },
      { classroomId: "c2", student: { email: "ben@x.org", firstName: "Ben" } },
      { classroomId: "c2", student: { email: "cy@x.org", firstName: "Cy" } },
    ]);

    const created = await createAssignments(
      teacher,
      ["c1", "c2", "c1"],
      { title: "Quiz 1", instructions: null, dueAt: null, mode: "QUIZ", questionIds: ["q1"] },
      NOW,
    );

    expect(created).toEqual([
      { classroomId: "c1", id: "a-c1" },
      { classroomId: "c2", id: "a-c2" },
    ]);
    expect(mocked.assignment.create.mock.calls.map((c) => c[0].data.mode)).toEqual(["QUIZ", "QUIZ"]);
    const emails = mocked.queuedEmail.createMany.mock.calls.flatMap((c) => c[0].data);
    expect(emails.map((e: { to: string }) => e.to)).toEqual(["ana@x.org", "ben@x.org", "cy@x.org"]);
    expect(emails[0].subject).toBe("New homework from Ms. R: Quiz 1");
    expect(emails[1].body).toContain("/homework/a-c2");
  });

  it("refuses the whole lot if any class isn't this teacher's or is archived, creating nothing", async () => {
    mocked.classroom.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, name: "x", teacherId: "t1", schoolId: "school1", archivedAt: where.id === "c2" ? NOW : null }),
    );
    await expect(
      createAssignments(teacher, ["c1", "c2"], { title: "HW", instructions: null, dueAt: null, questionIds: ["q1"] }, NOW),
    ).rejects.toMatchObject({ code: "CLASS_CLOSED" });
    expect(mocked.assignment.create).not.toHaveBeenCalled();
  });
});

describe("assignToMoreClasses", () => {
  const source = {
    id: "a1",
    classroomId: "c1",
    title: "Linear equations",
    instructions: "Show your work.",
    mode: "QUIZ",
    dueAt: null,
    closedAt: null,
    classroom: { id: "c1", name: "1st period", teacherId: "t1", schoolId: "school1", archivedAt: null },
  };

  beforeEach(() => {
    mocked.assignment.findUnique.mockResolvedValue(source);
    mocked.classroom.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, name: `Class ${where.id}`, teacherId: "t1", schoolId: "school1", archivedAt: null }),
    );
    mocked.assignment.create.mockImplementation(({ data }: { data: { classroomId: string } }) =>
      Promise.resolve({ id: `copy-${data.classroomId}` }),
    );
    // The revisions this class was given — one since replaced by a newer published one.
    mocked.assignmentQuestion.findMany.mockResolvedValue([
      { questionId: "q2", questionRevisionId: "r2-old" },
      { questionId: "q1", questionRevisionId: "r1" },
    ]);
  });

  it("copies the pinned revisions, title, instructions and mode, with the new due date, and emails each class", async () => {
    mocked.classroomEnrollment.findMany.mockResolvedValue([{ classroomId: "c2", student: { email: "ben@x.org", firstName: "Ben" } }]);
    const due = new Date("2026-11-20T05:59:59Z");

    const created = await assignToMoreClasses(teacher, "a1", ["c2", "c1", "c2"], { dueAt: due }, NOW);

    // Its own class is skipped, and never looked up again as a "current" question.
    expect(created).toEqual([{ classroomId: "c2", id: "copy-c2" }]);
    expect(mocked.question.findMany).not.toHaveBeenCalled();
    const data = mocked.assignment.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ classroomId: "c2", title: "Linear equations", instructions: "Show your work.", dueAt: due, mode: "QUIZ" });
    expect(data.questions.create).toEqual([
      { position: 0, questionId: "q2", questionRevisionId: "r2-old" },
      { position: 1, questionId: "q1", questionRevisionId: "r1" },
    ]);
    const emails = mocked.queuedEmail.createMany.mock.calls[0][0].data;
    expect(emails.map((e: { to: string }) => e.to)).toEqual(["ben@x.org"]);
    expect(emails[0].body).toContain("/homework/copy-c2");
    expect(emails[0].body).toContain("It's a quiz");
  });

  it("needs another class, and a due date that hasn't passed", async () => {
    await expect(assignToMoreClasses(teacher, "a1", ["c1"], { dueAt: null }, NOW)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      assignToMoreClasses(teacher, "a1", ["c2"], { dueAt: new Date(NOW.getTime() - 1) }, NOW),
    ).rejects.toThrow("hasn't passed");
    expect(mocked.assignment.create).not.toHaveBeenCalled();
  });

  it("refuses another teacher's homework as not found", async () => {
    mocked.assignment.findUnique.mockResolvedValue({ ...source, classroom: { ...source.classroom, teacherId: "someone-else" } });
    await expect(assignToMoreClasses(teacher, "a1", ["c2"], { dueAt: null }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocked.assignment.create).not.toHaveBeenCalled();
  });
});

describe("updateAssignment", () => {
  const owned = { id: "a1", mode: "PRACTICE", dueAt: null, classroom: { id: "c1", teacherId: "t1", schoolId: "school1" } };

  it("switches practice and quiz only while nobody has started, guarded in the write itself", async () => {
    mocked.assignment.findUnique.mockResolvedValue(owned);
    mocked.assignment.updateMany.mockResolvedValue({ count: 1 });
    await updateAssignment(teacher, "a1", { title: "HW", instructions: null, dueAt: null, mode: "QUIZ" }, NOW);
    expect(mocked.assignment.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "a1", sessions: { none: {} } },
      data: { mode: "QUIZ" },
    });
    expect(mocked.homeworkSession.count).not.toHaveBeenCalled();

    // A student started between the page loading and the save.
    mocked.assignment.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      updateAssignment(teacher, "a1", { title: "HW", instructions: null, dueAt: null, mode: "QUIZ" }, NOW),
    ).rejects.toMatchObject({ code: "HAS_WORK" });
  });

  it("saves a title alone with a plain update, never touching the mode guard", async () => {
    mocked.assignment.findUnique.mockResolvedValue(owned);
    await updateAssignment(teacher, "a1", { title: "New title", instructions: null, dueAt: null, mode: "PRACTICE" }, NOW);
    expect(mocked.assignment.update.mock.calls[0][0].data.title).toBe("New title");
    expect(mocked.assignment.updateMany).not.toHaveBeenCalled();
  });

  it("re-arms the day-before reminder when the due date moves", async () => {
    mocked.assignment.findUnique.mockResolvedValue(owned);
    const due = new Date("2026-11-10T05:59:59Z");
    await updateAssignment(teacher, "a1", { title: "HW", instructions: null, dueAt: due }, NOW);
    expect(mocked.assignment.update.mock.calls[0][0].data).toMatchObject({ dueAt: due, reminderQueuedAt: null });
  });

  it("treats the same calendar day as unchanged, even when the stored moment isn't end of day", async () => {
    // Like the demo district's homework: due mid-afternoon, already past.
    const stored = new Date("2026-10-30T20:15:00Z");
    mocked.assignment.findUnique.mockResolvedValue({ ...owned, dueAt: stored });
    // The edit form sends the day; the action turns it into the end of that day.
    const resent = endOfLocalDay("2026-10-30")!;

    await updateAssignment(teacher, "a1", { title: "Renamed", instructions: null, dueAt: resent }, NOW);

    const data = mocked.assignment.update.mock.calls[0][0].data;
    expect(data.dueAt).toBe(stored);
    expect(data).not.toHaveProperty("reminderQueuedAt");
  });

  it("keeps a future due date where it was when only the title changes", async () => {
    const stored = new Date("2026-11-12T15:00:00Z");
    mocked.assignment.findUnique.mockResolvedValue({ ...owned, dueAt: stored });
    await updateAssignment(teacher, "a1", { title: "HW", instructions: null, dueAt: endOfLocalDay("2026-11-12")! }, NOW);
    expect(mocked.assignment.update.mock.calls[0][0].data.dueAt).toBe(stored);
  });

  it("still refuses a new day that has already passed", async () => {
    mocked.assignment.findUnique.mockResolvedValue({ ...owned, dueAt: new Date("2026-11-12T15:00:00Z") });
    await expect(
      updateAssignment(teacher, "a1", { title: "HW", instructions: null, dueAt: endOfLocalDay("2026-10-20")! }, NOW),
    ).rejects.toThrow("hasn't passed");
  });
});

describe("deleteAssignment", () => {
  it("only deletes homework nobody has started, in one guarded statement", async () => {
    mocked.assignment.findUnique.mockResolvedValue({ id: "a1", classroom: { id: "c1", teacherId: "t1", schoolId: "school1" } });
    mocked.assignment.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteAssignment(teacher, "a1")).rejects.toMatchObject({ code: "HAS_WORK" });
    expect(mocked.assignment.deleteMany.mock.calls[0][0]).toEqual({ where: { id: "a1", sessions: { none: {} } } });
    expect(mocked.assignment.delete).not.toHaveBeenCalled();
    expect(mocked.homeworkSession.count).not.toHaveBeenCalled();
  });

  it("deletes homework nobody has started", async () => {
    mocked.assignment.findUnique.mockResolvedValue({ id: "a1", classroom: { id: "c1", teacherId: "t1", schoolId: "school1" } });
    mocked.assignment.deleteMany.mockResolvedValue({ count: 1 });
    await expect(deleteAssignment(teacher, "a1")).resolves.toBeUndefined();
  });
});

describe("remindUnfinished", () => {
  const due = new Date("2026-11-05T05:59:59Z");
  const homework = {
    id: "a1",
    classroomId: "c1",
    title: "Linear equations",
    dueAt: due,
    closedAt: null,
    lastNudgedAt: null,
    classroom: { id: "c1", name: "3rd period", teacherId: "t1", schoolId: "school1", archivedAt: null },
  };
  const before = new Date("2026-10-01");

  beforeEach(() => {
    mocked.assignment.findUnique.mockResolvedValue(homework);
    mocked.assignmentQuestion.count.mockResolvedValue(10);
    mocked.assignment.updateMany.mockResolvedValue({ count: 1 });
    mocked.classroomEnrollment.findMany.mockResolvedValue([
      { joinedAt: before, student: { id: "ada", email: "ada@x.org", firstName: "Ada" } },
      { joinedAt: before, student: { id: "ben", email: "ben@x.org", firstName: "Ben" } },
      { joinedAt: before, student: { id: "cy", email: "cy@x.org", firstName: "Cy" } },
      // Joined after it was due: optional for her, so no "past due" email.
      { joinedAt: new Date("2026-11-08"), student: { id: "eve", email: "eve@x.org", firstName: "Eve" } },
    ]);
    mocked.homeworkSession.findMany.mockResolvedValue([
      { studentId: "ada", status: "COMPLETED", _count: { slots: 10 } },
      { studentId: "ben", status: "ACTIVE", _count: { slots: 4 } },
    ]);
  });

  it("emails the current students who haven't turned it in, after the due date too, and claims the cooldown with them", async () => {
    const after = new Date("2026-11-09T15:00:00Z");

    expect(await remindUnfinished(teacher, "a1", after)).toEqual({ sent: 2 });

    // The roster query is the current one: removed students are never reminded.
    expect(mocked.classroomEnrollment.findMany.mock.calls[0][0].where).toMatchObject({ classroomId: "c1", removedAt: null });
    const claim = mocked.assignment.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: "a1", closedAt: null });
    expect(claim.data).toEqual({ lastNudgedAt: after });
    const rows = mocked.queuedEmail.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { to: string }) => r.to)).toEqual(["ben@x.org", "cy@x.org"]);
    expect(rows[0].subject).toBe("Past due: Linear equations");
    expect(rows[0].body).toContain("Ms. R still accepts it");
    expect(rows[0].body).toContain("You've answered 4 of 10");
    expect(rows[0].body).not.toMatch(/tomorrow|tonight/);
  });

  it("waits a day between reminders, and says until when", async () => {
    mocked.assignment.findUnique.mockResolvedValue({ ...homework, lastNudgedAt: new Date("2026-11-01T06:00:00Z") });
    await expect(remindUnfinished(teacher, "a1", NOW)).rejects.toMatchObject({ code: "LIMIT" });
    await expect(remindUnfinished(teacher, "a1", NOW)).rejects.toThrow("Nov 2");
    expect(mocked.queuedEmail.createMany).not.toHaveBeenCalled();
  });

  it("sends nothing when a second click loses the claim", async () => {
    mocked.assignment.updateMany.mockResolvedValue({ count: 0 });
    await expect(remindUnfinished(teacher, "a1", NOW)).rejects.toMatchObject({ code: "LIMIT" });
    expect(mocked.queuedEmail.createMany).not.toHaveBeenCalled();
  });

  it("refuses closed homework and claims nothing when everyone has finished", async () => {
    mocked.assignment.findUnique.mockResolvedValue({ ...homework, closedAt: NOW });
    await expect(remindUnfinished(teacher, "a1", NOW)).rejects.toMatchObject({ code: "ASSIGNMENT_CLOSED" });

    mocked.assignment.findUnique.mockResolvedValue(homework);
    mocked.homeworkSession.findMany.mockResolvedValue(
      ["ada", "ben", "cy"].map((studentId) => ({ studentId, status: "COMPLETED", _count: { slots: 10 } })),
    );
    expect(await remindUnfinished(teacher, "a1", NOW)).toEqual({ sent: 0 });
    expect(mocked.assignment.updateMany).not.toHaveBeenCalled();
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
      mode: "PRACTICE",
      createdAt: new Date("2026-11-01"),
      classroomId: "c1",
      classroom: { id: "c1", name: "3rd period", teacherId: "t1", schoolId: "school1" },
    });
    mocked.assignmentQuestion.findMany.mockResolvedValue([assigned(0, "q1", "EASY"), assigned(1, "q2", "HARD")]);
    const joined = new Date("2026-10-01");
    mocked.classroomEnrollment.findMany.mockResolvedValue([
      { joinedAt: joined, removedAt: null, lastName: "Lovelace", student: { id: "ada", firstName: "Ada", email: "ada@x.org" } },
      { joinedAt: joined, removedAt: null, lastName: null, student: { id: "ben", firstName: "Ben", email: "ben@x.org" } },
      { joinedAt: joined, removedAt: null, lastName: "Young", student: { id: "cy", firstName: "Cy", email: "cy@x.org" } },
      { joinedAt: joined, removedAt: new Date("2026-11-07"), lastName: null, student: { id: "dee", firstName: "Dee", email: "dee@x.org" } },
    ]);
    const answered = new Date("2026-11-03");
    mocked.homeworkSession.findMany.mockResolvedValue([
      {
        studentId: "ada",
        status: "COMPLETED",
        completedAt: new Date("2026-11-04"),
        student: { firstName: "Ada", email: "ada@x.org" },
        slots: [
          { position: 0, isCorrect: true, finalizedAt: answered, answer: "q1-k1" },
          { position: 1, isCorrect: true, finalizedAt: answered, answer: "q2-k1" },
        ],
      },
      {
        studentId: "ben",
        status: "ACTIVE",
        completedAt: null,
        student: { firstName: "Ben", email: "ben@x.org" },
        slots: [
          { position: 0, isCorrect: false, finalizedAt: answered, answer: "q1-k3" },
          { position: 1, isCorrect: null, finalizedAt: null, answer: null },
        ],
      },
      {
        // Left the class after finishing, late.
        studentId: "dee",
        status: "COMPLETED",
        completedAt: new Date("2026-11-06"),
        student: { firstName: "Dee", email: "dee@x.org" },
        slots: [
          { position: 0, isCorrect: true, finalizedAt: answered, answer: "q1-k1" },
          { position: 1, isCorrect: false, finalizedAt: answered, answer: "q2-k0" },
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
    // What each student actually answered, by letter, and the class's spread.
    expect(r.students.find((s) => s.studentId === "ben")).toMatchObject({
      lastName: null,
      answers: [{ position: 0, answer: "D", isCorrect: false }],
    });
    expect(r.students.find((s) => s.studentId === "ada")!.lastName).toBe("Lovelace");
    expect(r.questions[0]).toMatchObject({ correctAnswer: "B" });
    expect(r.questions[0].breakdown).toMatchObject({
      kind: "choices",
      choices: [
        { label: "A", count: 0, correct: false },
        { label: "B", count: 2, correct: true },
        { label: "C", count: 0, correct: false },
        { label: "D", count: 1, correct: false },
      ],
    });
    expect(r.mode).toBe("PRACTICE");
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
    // "Remind the N": Ben and Cy — never Dee, who left, or Ada, who finished.
    expect(r.reminder).toMatchObject({ recipients: 2, nextAllowedAt: null });
  });

  it("counts a student who joined after it was due as joined later, never missing or late", async () => {
    const due = new Date("2026-11-05T05:59:59Z");
    mocked.assignment.findUnique.mockResolvedValue({
      id: "a1",
      title: "HW",
      instructions: null,
      dueAt: due,
      closedAt: null,
      mode: "PRACTICE",
      createdAt: new Date("2026-11-01"),
      classroomId: "c1",
      classroom: { id: "c1", name: "3rd period", teacherId: "t1", schoolId: "school1" },
    });
    mocked.assignmentQuestion.findMany.mockResolvedValue([assigned(0, "q1", "EASY")]);
    const before = new Date("2026-10-01");
    const after = new Date("2026-11-08");
    mocked.classroomEnrollment.findMany.mockResolvedValue([
      { joinedAt: before, removedAt: null, lastName: null, student: { id: "ada", firstName: "Ada", email: "ada@x.org" } },
      { joinedAt: after, removedAt: null, lastName: null, student: { id: "eve", firstName: "Eve", email: "eve@x.org" } },
      { joinedAt: after, removedAt: null, lastName: null, student: { id: "fay", firstName: "Fay", email: "fay@x.org" } },
    ]);
    mocked.homeworkSession.findMany.mockResolvedValue([
      {
        // Joined after the due date and did it anyway.
        studentId: "fay",
        status: "COMPLETED",
        completedAt: new Date("2026-11-09"),
        student: { firstName: "Fay", email: "fay@x.org" },
        slots: [{ position: 0, isCorrect: true, finalizedAt: new Date("2026-11-09"), answer: "q1-k1" }],
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
    // Eve joined after it was due, so a reminder would only go to Ada.
    expect(r.reminder.recipients).toBe(1);
  });

  it("won't show another teacher's assignment", async () => {
    mocked.assignment.findUnique.mockResolvedValue({ id: "a1", classroom: { id: "c1", teacherId: "someone-else", schoolId: "school1" } });
    await expect(getAssignmentResults(teacher, "a1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocked.homeworkSession.findMany).not.toHaveBeenCalled();
  });
});
