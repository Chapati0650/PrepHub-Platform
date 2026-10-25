import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  completeHomeworkSession,
  finalizeHomeworkAnswer,
  joinClassroom,
  listHomework,
  startHomework,
} from "@/lib/teacher/homework";

vi.mock("@/lib/prisma", () => {
  const mock: Record<string, unknown> = {
    classroom: { findUnique: vi.fn() },
    classroomEnrollment: { upsert: vi.fn(), updateMany: vi.fn() },
    assignment: { findUnique: vi.fn(), findMany: vi.fn() },
    homeworkSession: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    homeworkSlot: { findUnique: vi.fn(), update: vi.fn() },
  };
  mock.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(mock));
  return { prisma: mock };
});

const mocked = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("joinClassroom", () => {
  it("rejects something that can't be a code without querying", async () => {
    await expect(joinClassroom("s1", "nope")).rejects.toMatchObject({ code: "CODE_NOT_FOUND" });
    expect(mocked.classroom.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a class its teacher has archived", async () => {
    mocked.classroom.findUnique.mockResolvedValue({ id: "c1", archivedAt: new Date() });
    await expect(joinClassroom("s1", "ACD-EFG")).rejects.toMatchObject({ code: "CLASS_CLOSED" });
    expect(mocked.classroomEnrollment.upsert).not.toHaveBeenCalled();
  });

  it("joins idempotently, and a removed student who rejoins is restored rather than duplicated", async () => {
    mocked.classroom.findUnique.mockResolvedValue({ id: "c1", archivedAt: null });

    expect(await joinClassroom("s1", "acd efg")).toEqual({ classroomId: "c1" });
    expect(mocked.classroom.findUnique.mock.calls[0][0].where).toEqual({ joinCode: "ACDEFG" });
    expect(mocked.classroomEnrollment.upsert.mock.calls[0][0]).toEqual({
      where: { classroomId_studentId: { classroomId: "c1", studentId: "s1" } },
      update: { removedAt: null },
      create: { classroomId: "c1", studentId: "s1" },
    });
  });
});

function assignmentFor(overrides: Record<string, unknown> = {}) {
  return {
    closedAt: null,
    classroom: { archivedAt: null, enrollments: [{ id: "e1" }] },
    questions: [
      { position: 0, questionId: "q1", questionRevisionId: "r1" },
      { position: 1, questionId: "q2", questionRevisionId: "r2" },
    ],
    sessions: [],
    ...overrides,
  };
}

describe("startHomework", () => {
  it("returns the session a student already has, even after the homework closes", async () => {
    mocked.assignment.findUnique.mockResolvedValue(assignmentFor({ closedAt: new Date(), sessions: [{ id: "hs1" }] }));
    expect(await startHomework("s1", "a1")).toEqual({ sessionId: "hs1" });
    expect(mocked.homeworkSession.create).not.toHaveBeenCalled();
  });

  it("won't start for a student who isn't in the class", async () => {
    mocked.assignment.findUnique.mockResolvedValue(assignmentFor({ classroom: { archivedAt: null, enrollments: [] } }));
    await expect(startHomework("s1", "a1")).rejects.toMatchObject({ code: "NOT_IN_CLASS" });
  });

  it("won't start homework the teacher closed", async () => {
    mocked.assignment.findUnique.mockResolvedValue(assignmentFor({ closedAt: new Date() }));
    await expect(startHomework("s1", "a1")).rejects.toMatchObject({ code: "ASSIGNMENT_CLOSED" });
  });

  it("creates one slot per question, at the pinned revisions, in order", async () => {
    mocked.assignment.findUnique.mockResolvedValue(assignmentFor());
    mocked.homeworkSession.create.mockResolvedValue({ id: "hs1" });

    expect(await startHomework("s1", "a1")).toEqual({ sessionId: "hs1" });
    expect(mocked.homeworkSession.create.mock.calls[0][0].data.slots.create).toEqual([
      { position: 0, questionId: "q1", questionRevisionId: "r1" },
      { position: 1, questionId: "q2", questionRevisionId: "r2" },
    ]);
  });

  it("treats losing a double-click race as success: the other request's session is the one", async () => {
    mocked.assignment.findUnique.mockResolvedValue(assignmentFor());
    mocked.homeworkSession.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    mocked.homeworkSession.findUnique.mockResolvedValue({ id: "hs-other" });

    expect(await startHomework("s1", "a1")).toEqual({ sessionId: "hs-other" });
  });
});

function slotFor(overrides: Record<string, unknown> = {}) {
  return {
    id: "slot1",
    finalizedAt: null,
    isCorrect: null,
    answer: null,
    session: { studentId: "s1", status: "ACTIVE", assignment: { closedAt: null } },
    question: { questionType: "MULTIPLE_CHOICE" },
    questionRevision: {
      acceptedAnswers: [],
      answerChoices: [
        { id: "A", isCorrect: false },
        { id: "B", isCorrect: true },
      ],
    },
    ...overrides,
  };
}

describe("finalizeHomeworkAnswer", () => {
  it("grades and records an answer", async () => {
    mocked.homeworkSlot.findUnique.mockResolvedValue(slotFor());
    expect(await finalizeHomeworkAnswer({ studentId: "s1", slotId: "slot1", answer: "B" })).toEqual({ isCorrect: true, answer: "B" });
    expect(mocked.homeworkSlot.update.mock.calls[0][0].data).toMatchObject({ answer: "B", isCorrect: true, draftAnswer: null });
  });

  it("is idempotent: a retried submit returns the first answer and grades nothing", async () => {
    mocked.homeworkSlot.findUnique.mockResolvedValue(slotFor({ finalizedAt: new Date(), isCorrect: false, answer: "A" }));
    expect(await finalizeHomeworkAnswer({ studentId: "s1", slotId: "slot1", answer: "B" })).toEqual({ isCorrect: false, answer: "A" });
    expect(mocked.homeworkSlot.update).not.toHaveBeenCalled();
  });

  it("refuses another student's slot", async () => {
    mocked.homeworkSlot.findUnique.mockResolvedValue(slotFor({ session: { studentId: "someone-else", status: "ACTIVE", assignment: { closedAt: null } } }));
    await expect(finalizeHomeworkAnswer({ studentId: "s1", slotId: "slot1", answer: "B" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("takes no new answers once the teacher closes the homework", async () => {
    mocked.homeworkSlot.findUnique.mockResolvedValue(slotFor({ session: { studentId: "s1", status: "ACTIVE", assignment: { closedAt: new Date() } } }));
    await expect(finalizeHomeworkAnswer({ studentId: "s1", slotId: "slot1", answer: "B" })).rejects.toMatchObject({
      code: "ASSIGNMENT_CLOSED",
    });
    expect(mocked.homeworkSlot.update).not.toHaveBeenCalled();
  });
});

describe("completeHomeworkSession", () => {
  it("won't turn in homework with blanks, and says how many", async () => {
    mocked.homeworkSession.findUnique.mockResolvedValue({
      studentId: "s1",
      status: "ACTIVE",
      slots: [{ finalizedAt: new Date() }, { finalizedAt: null }, { finalizedAt: null }],
    });
    await expect(completeHomeworkSession("s1", "hs1")).rejects.toMatchObject({ code: "BLANKS_REMAIN", details: { unanswered: 2 } });
  });

  it("completes once, guarded on still being active", async () => {
    mocked.homeworkSession.findUnique.mockResolvedValue({ studentId: "s1", status: "ACTIVE", slots: [{ finalizedAt: new Date() }] });
    await completeHomeworkSession("s1", "hs1");
    expect(mocked.homeworkSession.updateMany.mock.calls[0][0].where).toEqual({ id: "hs1", status: "ACTIVE" });
  });
});

describe("listHomework", () => {
  const base = {
    instructions: null,
    createdAt: new Date("2026-10-01"),
    classroom: { name: "3rd period", teacher: { firstName: "Ms. R" } },
    _count: { questions: 2 },
  };

  it("puts the soonest due first, undated last, drops closed work never started, and keeps finished work", async () => {
    mocked.assignment.findMany.mockResolvedValue([
      { ...base, id: "undated", title: "Undated", dueAt: null, closedAt: null, sessions: [] },
      { ...base, id: "later", title: "Later", dueAt: new Date("2026-11-20"), closedAt: null, sessions: [] },
      { ...base, id: "sooner", title: "Sooner", dueAt: new Date("2026-11-10"), closedAt: null, sessions: [] },
      { ...base, id: "closed", title: "Closed", dueAt: null, closedAt: new Date(), sessions: [] },
      {
        ...base,
        id: "done",
        title: "Done",
        dueAt: null,
        closedAt: new Date(),
        sessions: [
          {
            id: "hs",
            status: "COMPLETED",
            completedAt: new Date("2026-10-20"),
            slots: [
              { isCorrect: true, finalizedAt: new Date() },
              { isCorrect: false, finalizedAt: new Date() },
            ],
          },
        ],
      },
    ]);

    const { todo, done } = await listHomework("s1");

    expect(todo.map((i) => i.assignmentId)).toEqual(["sooner", "later", "undated"]);
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ assignmentId: "done", status: "COMPLETED", correct: 1, answered: 2, sessionId: "hs" });
  });
});
