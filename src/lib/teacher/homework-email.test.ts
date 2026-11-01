import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { endOfLocalDay } from "@/lib/community/local-day";
import {
  assignedEmailRows,
  homeworkNudgeMessage,
  homeworkReminderMessage,
  needsNudge,
  nudgeAvailableAt,
  queueHomeworkReminders,
  reminderDue,
} from "./homework-email";

vi.mock("@/lib/prisma", () => {
  const mock: Record<string, unknown> = {
    assignment: { findMany: vi.fn(), updateMany: vi.fn() },
    queuedEmail: { createMany: vi.fn() },
  };
  mock.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(mock));
  return { prisma: mock };
});
const mocked = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const HOUR = 60 * 60 * 1000;
// The daily run: 22:00 UTC, which is 4pm Central on this November day.
const run = new Date("2026-11-03T22:00:00Z");
const dueTomorrow = endOfLocalDay("2026-11-04")!;
const dueTonight = endOfLocalDay("2026-11-03")!;
const dueInTwoDays = endOfLocalDay("2026-11-05")!;
const lastWeek = new Date(run.getTime() - 7 * 24 * HOUR);

describe("reminderDue", () => {
  const open = { createdAt: lastWeek, closedAt: null, reminderQueuedAt: null };

  it("reminds about homework due tomorrow, or tonight if it was missed yesterday", () => {
    expect(reminderDue({ ...open, dueAt: dueTomorrow }, run)).toBe(true);
    expect(reminderDue({ ...open, dueAt: dueTonight }, run)).toBe(true);
  });

  it("waits for the day before", () => {
    expect(reminderDue({ ...open, dueAt: dueInTwoDays }, run)).toBe(false);
  });

  it("never reminds about closed, past-due, undated or already-reminded homework", () => {
    expect(reminderDue({ ...open, dueAt: dueTomorrow, closedAt: lastWeek }, run)).toBe(false);
    expect(reminderDue({ ...open, dueAt: new Date(run.getTime() - HOUR) }, run)).toBe(false);
    expect(reminderDue({ ...open, dueAt: null }, run)).toBe(false);
    expect(reminderDue({ ...open, dueAt: dueTomorrow, reminderQueuedAt: lastWeek }, run)).toBe(false);
  });

  it("skips homework assigned so recently that its students were just told about it", () => {
    expect(reminderDue({ ...open, dueAt: dueTomorrow, createdAt: new Date(run.getTime() - 2 * HOUR) }, run)).toBe(false);
  });
});

describe("queueHomeworkReminders", () => {
  const homework = {
    id: "a1",
    title: "Linear equations",
    dueAt: dueTomorrow,
    createdAt: lastWeek,
    closedAt: null,
    reminderQueuedAt: null,
    _count: { questions: 10 },
    classroom: {
      name: "1st Period",
      enrollments: [
        { student: { id: "ana", email: "ana@school.org", firstName: "Ana" } },
        { student: { id: "ben", email: "ben@school.org", firstName: "Ben" } },
        { student: { id: "cy", email: "cy@school.org", firstName: "Cy" } },
      ],
    },
    sessions: [
      { studentId: "ana", status: "COMPLETED", _count: { slots: 10 } },
      { studentId: "ben", status: "ACTIVE", _count: { slots: 4 } },
    ],
  };

  it("reminds only the students who haven't finished, and claims the homework in the same transaction", async () => {
    vi.clearAllMocks();
    mocked.assignment.findMany.mockResolvedValue([homework]);
    mocked.assignment.updateMany.mockResolvedValue({ count: 1 });

    expect(await queueHomeworkReminders(run)).toBe(2);
    expect(mocked.assignment.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "a1", reminderQueuedAt: null },
      data: { reminderQueuedAt: run },
    });
    const rows = mocked.queuedEmail.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { to: string }) => r.to)).toEqual(["ben@school.org", "cy@school.org"]);
    expect(rows[0].body).toContain("You've answered 4 of 10");
  });

  it("queues nothing when another run already claimed it", async () => {
    vi.clearAllMocks();
    mocked.assignment.findMany.mockResolvedValue([homework]);
    mocked.assignment.updateMany.mockResolvedValue({ count: 0 });

    expect(await queueHomeworkReminders(run)).toBe(0);
    expect(mocked.queuedEmail.createMany).not.toHaveBeenCalled();
  });
});

describe("homeworkReminderMessage", () => {
  const base = {
    student: { email: "ana@school.org", firstName: "Ana" },
    className: "1st Period SAT Prep",
    title: "Linear equations",
    questionCount: 10,
    assignmentId: "a1",
    now: run,
  };

  it("says tomorrow or tonight by the school's calendar", () => {
    expect(homeworkReminderMessage({ ...base, answered: 0, dueAt: dueTomorrow }).subject).toBe("Due tomorrow: Linear equations");
    expect(homeworkReminderMessage({ ...base, answered: 0, dueAt: dueTonight }).subject).toBe("Due tonight: Linear equations");
  });

  it("tells a student who has started how far they got", () => {
    const started = homeworkReminderMessage({ ...base, answered: 3, dueAt: dueTomorrow }).body;
    expect(started).toContain("You've answered 3 of 10. Finish it here:");
    expect(started).toContain("is due tomorrow (Wednesday, Nov 4)");
    expect(homeworkReminderMessage({ ...base, answered: 0, dueAt: dueTomorrow }).body).toContain("It's 10 questions. Start it here:");
  });
});

describe("homeworkNudgeMessage", () => {
  const base = {
    student: { email: "ana@school.org", firstName: "Ana" },
    teacher: "Ms. Alvarez",
    className: "1st Period SAT Prep",
    title: "Linear equations",
    questionCount: 10,
    answered: 0,
    assignmentId: "a1",
    now: run,
  };

  it("says where the deadline stands on the day it's sent, never \"tomorrow\" after the fact", () => {
    const early = homeworkNudgeMessage({ ...base, dueAt: dueInTwoDays });
    expect(early.subject).toBe("Reminder from Ms. Alvarez: Linear equations");
    expect(early.body).toContain("It's due Thursday, Nov 5.");
    expect(homeworkNudgeMessage({ ...base, dueAt: dueTomorrow }).body).toContain("It's due tomorrow (Wednesday, Nov 4).");
    expect(homeworkNudgeMessage({ ...base, dueAt: dueTonight }).body).toContain("It's due tonight.");

    const late = homeworkNudgeMessage({ ...base, dueAt: endOfLocalDay("2026-11-01")!, answered: 6 });
    expect(late.subject).toBe("Past due: Linear equations");
    expect(late.body).toContain("It was due Sunday, Nov 1. Ms. Alvarez still accepts it - it will be marked late.");
    expect(late.body).toContain("You've answered 6 of 10. Finish it here:");
    expect(late.body).not.toMatch(/tomorrow|tonight/);
  });

  it("leaves the deadline out of homework with no due date", () => {
    const body = homeworkNudgeMessage({ ...base, dueAt: null }).body;
    expect(body).not.toContain("due");
    expect(body).toContain("Ms. Alvarez sent a reminder about your 1st Period SAT Prep homework");
  });

  it("keeps every stored body within WIN1252", () => {
    for (const dueAt of [null, dueTomorrow, endOfLocalDay("2026-11-01")!]) {
      const row = homeworkNudgeMessage({ ...base, dueAt });
      for (const text of [row.body, row.subject]) {
        expect([...text].every((c) => c.charCodeAt(0) < 256 || "‘’“”–—…".includes(c))).toBe(true);
      }
    }
  });
});

describe("needsNudge", () => {
  it("is everyone on the roster who hasn't turned it in, except those who joined after it was due", () => {
    expect(needsNudge({ enrolled: true, completed: false, joinedLater: false })).toBe(true);
    expect(needsNudge({ enrolled: true, completed: true, joinedLater: false })).toBe(false);
    expect(needsNudge({ enrolled: false, completed: false, joinedLater: false })).toBe(false);
    expect(needsNudge({ enrolled: true, completed: false, joinedLater: true })).toBe(false);
  });
});

describe("nudgeAvailableAt", () => {
  it("allows one reminder a day per homework", () => {
    expect(nudgeAvailableAt(null, run)).toBeNull();
    const sent = new Date(run.getTime() - 3 * HOUR);
    expect(nudgeAvailableAt(sent, run)).toEqual(new Date(sent.getTime() + 24 * HOUR));
    expect(nudgeAvailableAt(new Date(run.getTime() - 24 * HOUR), run)).toBeNull();
  });
});

describe("assignedEmailRows", () => {
  it("writes one email per student, naming the teacher the way the class knows them", () => {
    const rows = assignedEmailRows(
      {
        teacher: { firstName: "Maria", teacherDisplayName: "Ms. Alvarez" },
        className: "1st Period SAT Prep",
        title: "Linear equations",
        questionCount: 1,
        dueAt: dueTomorrow,
        mode: "QUIZ",
        assignmentId: "a1",
      },
      [
        { email: "ana@school.org", firstName: "Ana" },
        { email: "ben@school.org", firstName: "Ben" },
      ],
    );
    expect(rows.map((r) => r.to)).toEqual(["ana@school.org", "ben@school.org"]);
    expect(rows[0].subject).toBe("New homework from Ms. Alvarez: Linear equations");
    expect(rows[0].body).toContain("Hi Ana,");
    expect(rows[0].body).toContain("1 question, due Wednesday, Nov 4.");
    expect(rows[0].body).toContain("It's a quiz");
    expect(rows[1].body).toContain("Hi Ben,");
  });

  it("keeps every stored body within WIN1252", () => {
    const rows = assignedEmailRows(
      {
        teacher: { firstName: "Maria", teacherDisplayName: null },
        className: "Algebra",
        title: "Warm-up",
        questionCount: 5,
        dueAt: null,
        mode: "PRACTICE",
        assignmentId: "a1",
      },
      [{ email: "ana@school.org", firstName: "Ana" }],
    );
    const reminder = homeworkReminderMessage({
      student: { email: "ana@school.org", firstName: "Ana" },
      className: "Algebra",
      title: "Warm-up",
      questionCount: 5,
      answered: 2,
      dueAt: dueTomorrow,
      assignmentId: "a1",
      now: run,
    });
    for (const text of [rows[0].body, rows[0].subject, reminder.body, reminder.subject]) {
      expect([...text].every((c) => c.charCodeAt(0) < 256 || "‘’“”–—…".includes(c))).toBe(true);
    }
  });
});
