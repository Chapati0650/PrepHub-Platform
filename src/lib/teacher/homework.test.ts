import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  completeHomeworkSession,
  finalizeHomeworkAnswer,
  getHomeworkSessionForRunner,
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
    homeworkSlot: { findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
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

const OPEN_ASSIGNMENT = { id: "a1", closedAt: null, classroom: { archivedAt: null, enrollments: [{ id: "e1" }] } };

function slotFor(overrides: Record<string, unknown> = {}, assignment: Record<string, unknown> = {}) {
  return {
    id: "slot1",
    sessionId: "hs1",
    finalizedAt: null,
    isCorrect: null,
    answer: null,
    session: { studentId: "s1", status: "ACTIVE", assignment: { ...OPEN_ASSIGNMENT, ...assignment } },
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
  beforeEach(() => {
    mocked.homeworkSlot.updateMany.mockResolvedValue({ count: 1 });
    mocked.homeworkSlot.count.mockResolvedValue(1);
  });

  it("grades and records an answer, guarded on the slot still being unanswered", async () => {
    mocked.homeworkSlot.findUnique.mockResolvedValue(slotFor());
    expect(await finalizeHomeworkAnswer({ studentId: "s1", slotId: "slot1", answer: "B" })).toEqual({
      isCorrect: true,
      answer: "B",
      completed: false,
    });
    const write = mocked.homeworkSlot.updateMany.mock.calls[0][0];
    expect(write.where).toEqual({ id: "slot1", finalizedAt: null });
    expect(write.data).toMatchObject({ answer: "B", isCorrect: true, draftAnswer: null });
    expect(mocked.homeworkSession.updateMany).not.toHaveBeenCalled();
  });

  it("turns the homework in with its last answer, dated by that answer", async () => {
    mocked.homeworkSlot.findUnique.mockResolvedValue(slotFor());
    mocked.homeworkSlot.count.mockResolvedValue(0);

    expect(await finalizeHomeworkAnswer({ studentId: "s1", slotId: "slot1", answer: "A" })).toMatchObject({ completed: true });
    expect(mocked.homeworkSlot.count.mock.calls[0][0].where).toEqual({ sessionId: "hs1", finalizedAt: null });
    const turnIn = mocked.homeworkSession.updateMany.mock.calls[0][0];
    expect(turnIn.where).toEqual({ id: "hs1", status: "ACTIVE" });
    expect(turnIn.data.status).toBe("COMPLETED");
    expect(turnIn.data.completedAt).toBe(mocked.homeworkSlot.updateMany.mock.calls[0][0].data.finalizedAt);
  });

  it("is idempotent: a retried submit returns the first answer and grades nothing", async () => {
    mocked.homeworkSlot.findUnique.mockResolvedValue(slotFor({ finalizedAt: new Date(), isCorrect: false, answer: "A" }));
    expect(await finalizeHomeworkAnswer({ studentId: "s1", slotId: "slot1", answer: "B" })).toEqual({
      isCorrect: false,
      answer: "A",
      completed: false,
    });
    expect(mocked.homeworkSlot.updateMany).not.toHaveBeenCalled();
  });

  it("returns the answer that won when a concurrent submit recorded first", async () => {
    mocked.homeworkSlot.findUnique
      .mockResolvedValueOnce(slotFor())
      .mockResolvedValueOnce({ answer: "A", isCorrect: false, session: { status: "ACTIVE" } });
    mocked.homeworkSlot.updateMany.mockResolvedValue({ count: 0 });

    expect(await finalizeHomeworkAnswer({ studentId: "s1", slotId: "slot1", answer: "B" })).toEqual({
      isCorrect: false,
      answer: "A",
      completed: false,
    });
    expect(mocked.homeworkSlot.count).not.toHaveBeenCalled();
    expect(mocked.homeworkSession.updateMany).not.toHaveBeenCalled();
  });

  it("refuses another student's slot", async () => {
    mocked.homeworkSlot.findUnique.mockResolvedValue(
      slotFor({ session: { studentId: "someone-else", status: "ACTIVE", assignment: OPEN_ASSIGNMENT } }),
    );
    await expect(finalizeHomeworkAnswer({ studentId: "s1", slotId: "slot1", answer: "B" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("takes no new answers once the teacher closes the homework, and says which homework", async () => {
    mocked.homeworkSlot.findUnique.mockResolvedValue(slotFor({}, { closedAt: new Date() }));
    await expect(finalizeHomeworkAnswer({ studentId: "s1", slotId: "slot1", answer: "B" })).rejects.toMatchObject({
      code: "ASSIGNMENT_CLOSED",
      details: { assignmentId: "a1" },
    });
    expect(mocked.homeworkSlot.updateMany).not.toHaveBeenCalled();
  });

  it("takes no new answers from a student taken off the roster", async () => {
    mocked.homeworkSlot.findUnique.mockResolvedValue(slotFor({}, { classroom: { archivedAt: null, enrollments: [] } }));
    await expect(finalizeHomeworkAnswer({ studentId: "s1", slotId: "slot1", answer: "B" })).rejects.toMatchObject({
      code: "NOT_IN_CLASS",
    });
    expect(mocked.homeworkSlot.updateMany).not.toHaveBeenCalled();
  });

  it("takes no new answers in an archived class", async () => {
    mocked.homeworkSlot.findUnique.mockResolvedValue(
      slotFor({}, { classroom: { archivedAt: new Date(), enrollments: [{ id: "e1" }] } }),
    );
    await expect(finalizeHomeworkAnswer({ studentId: "s1", slotId: "slot1", answer: "B" })).rejects.toMatchObject({
      code: "CLASS_CLOSED",
    });
    expect(mocked.homeworkSlot.updateMany).not.toHaveBeenCalled();
  });
});

describe("completeHomeworkSession", () => {
  it("won't turn in homework with blanks, and says how many", async () => {
    mocked.homeworkSession.findUnique.mockResolvedValue({
      studentId: "s1",
      status: "ACTIVE",
      assignment: OPEN_ASSIGNMENT,
      slots: [{ finalizedAt: new Date() }, { finalizedAt: null }, { finalizedAt: null }],
    });
    await expect(completeHomeworkSession("s1", "hs1")).rejects.toMatchObject({ code: "BLANKS_REMAIN", details: { unanswered: 2 } });
  });

  it("says the homework is closed, not that blanks remain, once the teacher has closed it", async () => {
    mocked.homeworkSession.findUnique.mockResolvedValue({
      studentId: "s1",
      status: "ACTIVE",
      assignment: { ...OPEN_ASSIGNMENT, closedAt: new Date() },
      slots: [{ finalizedAt: new Date() }, { finalizedAt: null }],
    });
    await expect(completeHomeworkSession("s1", "hs1")).rejects.toMatchObject({ code: "ASSIGNMENT_CLOSED" });
  });

  it("completes once, guarded on still being active, dated by the last answer", async () => {
    const first = new Date("2026-11-03T10:00:00Z");
    const last = new Date("2026-11-03T10:20:00Z");
    mocked.homeworkSession.findUnique.mockResolvedValue({
      studentId: "s1",
      status: "ACTIVE",
      assignment: OPEN_ASSIGNMENT,
      slots: [{ finalizedAt: last }, { finalizedAt: first }],
    });
    await completeHomeworkSession("s1", "hs1");
    const call = mocked.homeworkSession.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "hs1", status: "ACTIVE" });
    expect(call.data).toEqual({ status: "COMPLETED", completedAt: last });
  });

  it("turns in fully answered work even after the teacher closed it", async () => {
    mocked.homeworkSession.findUnique.mockResolvedValue({
      studentId: "s1",
      status: "ACTIVE",
      assignment: { ...OPEN_ASSIGNMENT, closedAt: new Date() },
      slots: [{ finalizedAt: new Date() }],
    });
    await completeHomeworkSession("s1", "hs1");
    expect(mocked.homeworkSession.updateMany).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for homework already turned in, so the runner's Turn in lands on the results", async () => {
    mocked.homeworkSession.findUnique.mockResolvedValue({
      studentId: "s1",
      status: "COMPLETED",
      assignment: { ...OPEN_ASSIGNMENT, closedAt: new Date() },
      slots: [{ finalizedAt: new Date() }],
    });
    await expect(completeHomeworkSession("s1", "hs1")).resolves.toBeUndefined();
    expect(mocked.homeworkSession.updateMany).not.toHaveBeenCalled();
  });

  it("refuses another student's session", async () => {
    mocked.homeworkSession.findUnique.mockResolvedValue({ studentId: "someone-else", status: "ACTIVE", assignment: OPEN_ASSIGNMENT, slots: [] });
    await expect(completeHomeworkSession("s1", "hs1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getHomeworkSessionForRunner", () => {
  it("says when the student can no longer answer", async () => {
    mocked.homeworkSession.findUnique.mockResolvedValue({
      id: "hs1",
      studentId: "s1",
      slots: [],
      assignment: { id: "a1", title: "HW", closedAt: null, classroom: { name: "3rd", archivedAt: null, enrollments: [] } },
    });
    expect(await getHomeworkSessionForRunner("s1", "hs1")).toMatchObject({ blocked: "NOT_IN_CLASS" });
  });

  it("is null for someone else's session", async () => {
    mocked.homeworkSession.findUnique.mockResolvedValue({ id: "hs1", studentId: "other", slots: [], assignment: OPEN_ASSIGNMENT });
    expect(await getHomeworkSessionForRunner("s1", "hs1")).toBeNull();
  });
});

describe("listHomework", () => {
  const base = {
    instructions: null,
    createdAt: new Date("2026-10-01"),
    classroom: { name: "3rd period", teacher: { firstName: "Ms. R" }, enrollments: [{ joinedAt: new Date("2026-09-01") }] },
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

  it("keeps homework that was already due when the student joined out of to do, and never overdue", async () => {
    const lateJoiner = { ...base, classroom: { ...base.classroom, enrollments: [{ joinedAt: new Date("2026-10-15") }] } };
    mocked.assignment.findMany.mockResolvedValue([
      { ...lateJoiner, id: "before", title: "Before", dueAt: new Date("2026-10-10"), closedAt: null, sessions: [] },
      { ...lateJoiner, id: "after", title: "After", dueAt: new Date("2026-11-10"), closedAt: null, sessions: [] },
    ]);

    const { todo, earlier } = await listHomework("s1");

    expect(todo.map((i) => i.assignmentId)).toEqual(["after"]);
    expect(earlier.map((i) => i.assignmentId)).toEqual(["before"]);
    expect(earlier[0].setBeforeJoining).toBe(true);
  });

  it("keeps fully answered work that was never turned in, even after the teacher closed it", async () => {
    mocked.assignment.findMany.mockResolvedValue([
      {
        ...base,
        id: "answered",
        title: "Answered",
        dueAt: null,
        closedAt: new Date(),
        sessions: [
          {
            id: "hs",
            status: "ACTIVE",
            completedAt: null,
            slots: [
              { isCorrect: true, finalizedAt: new Date() },
              { isCorrect: true, finalizedAt: new Date() },
            ],
          },
        ],
      },
    ]);

    const { todo } = await listHomework("s1");

    expect(todo).toHaveLength(1);
    expect(todo[0]).toMatchObject({ assignmentId: "answered", status: "IN_PROGRESS", readyToTurnIn: true, sessionId: "hs" });
  });
});
