import { describe, it, expect, vi, beforeEach } from "vitest";
import { finishDiagnosticMessage, queueDailyReminders, queueFinishDiagnosticNudges } from "./emails";
import { prisma } from "@/lib/prisma";
import { studentsActiveSince } from "@/lib/school/student-activity";

const tx = {
  emailSend: { createManyAndReturn: vi.fn() },
  queuedEmail: { createMany: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    emailSend: { create: vi.fn() },
    predictionHistoryEntry: { findFirst: vi.fn() },
    categoryState: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/school/student-activity", () => ({ studentsActiveSince: vi.fn() }));

const users = prisma.user.findMany as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const activeSince = studentsActiveSince as ReturnType<typeof vi.fn>;

/** What the queue was given, across every page and transaction. */
function queued(): { kind: string; to: string; subject: string; body: string }[] {
  return tx.queuedEmail.createMany.mock.calls.flatMap((call) => call[0].data);
}

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
  // By default every claim is new: the insert hands back every row it was given.
  tx.emailSend.createManyAndReturn.mockImplementation(({ data }: { data: { userId: string }[] }) =>
    Promise.resolve(data.map(({ userId }) => ({ userId }))),
  );
  tx.queuedEmail.createMany.mockResolvedValue({ count: 0 });
  activeSince.mockResolvedValue(new Set());
});

const answered = (category: string, difficulty: string) => ({
  id: `${category}-${difficulty}`,
  category,
  difficulty,
  submittedAt: new Date(),
  isCorrect: true,
  waivedAt: null,
});
const open = (category: string, difficulty: string) => ({ ...answered(category, difficulty), submittedAt: null, isCorrect: null });

describe("finishDiagnosticMessage", () => {
  it("puts the student's progress in the subject", () => {
    // Three core questions answered, out of the staged Diagnostic's fourteen.
    const message = finishDiagnosticMessage({
      email: "a@x.com",
      firstName: "Ada",
      diagnosticSession: {
        attempts: [
          answered("ADVANCED_MATH", "EASY"),
          answered("VOCABULARY", "EASY"),
          answered("ALGEBRA", "EASY"),
          open("GRAMMAR", "EASY"),
          open("ALGEBRA", "MEDIUM"),
        ],
      } as never,
    });
    expect(message.subject).toBe("You're 3 of 14 questions in");
    expect(message.text).toContain("remaining 11");
  });

  it("invites a student who never started", () => {
    const message = finishDiagnosticMessage({ email: "b@x.com", firstName: "Ben", diagnosticSession: null });
    expect(message.subject).toBe("Your predicted SAT score is 14 questions away");
  });

  it("tells a student who finished the core that a bonus round is waiting", () => {
    // Every Easy and Medium answered, Algebra's Medium right: Algebra's Hard
    // question was earned and is still to answer.
    const categories = [
      "READING_COMPREHENSION",
      "GRAMMAR",
      "VOCABULARY",
      "ALGEBRA",
      "GEOMETRY_TRIGONOMETRY",
      "ADVANCED_MATH",
      "PROBLEM_SOLVING_DATA_ANALYSIS",
    ];
    const attempts = categories.flatMap((category) => [
      { ...answered(category, "EASY") },
      { ...answered(category, "MEDIUM"), isCorrect: category === "ALGEBRA" },
      { ...open(category, "HARD") },
    ]);
    const message = finishDiagnosticMessage({ email: "a@x.com", firstName: "Ada", diagnosticSession: { attempts } as never });
    expect(message.subject).toBe("Your bonus round is waiting");
  });
});

describe("queueFinishDiagnosticNudges", () => {
  it("claims each candidate once and queues their message, sending nothing itself", async () => {
    users.mockResolvedValueOnce([
      { id: "u1", email: "a@x.com", firstName: "Ada", diagnosticSession: null },
      { id: "u2", email: "b@x.com", firstName: "Ben", diagnosticSession: null },
    ]);

    expect(await queueFinishDiagnosticNudges(new Date("2026-09-21T22:00:00Z"))).toBe(2);

    expect(tx.emailSend.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        { userId: "u1", kind: "finish_diagnostic", day: "once" },
        { userId: "u2", kind: "finish_diagnostic", day: "once" },
      ],
      skipDuplicates: true,
      select: { userId: true },
    });
    expect(queued().map((r) => [r.kind, r.to])).toEqual([
      ["finish_diagnostic", "a@x.com"],
      ["finish_diagnostic", "b@x.com"],
    ]);
  });

  it("queues nothing for a student whose claim already existed (a re-run)", async () => {
    users.mockResolvedValueOnce([
      { id: "u1", email: "a@x.com", firstName: "Ada", diagnosticSession: null },
      { id: "u2", email: "b@x.com", firstName: "Ben", diagnosticSession: null },
    ]);
    tx.emailSend.createManyAndReturn.mockResolvedValueOnce([{ userId: "u2" }]);

    expect(await queueFinishDiagnosticNudges()).toBe(1);
    expect(queued().map((r) => r.to)).toEqual(["b@x.com"]);
  });

  it("reads the next page after the last id when a page comes back full", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({
      id: `u${String(i).padStart(4, "0")}`,
      email: `s${i}@x.com`,
      firstName: "S",
      diagnosticSession: null,
    }));
    users.mockResolvedValueOnce(full).mockResolvedValueOnce([{ id: "u9999", email: "last@x.com", firstName: "L", diagnosticSession: null }]);

    expect(await queueFinishDiagnosticNudges()).toBe(1001);
    expect(users).toHaveBeenCalledTimes(2);
    expect(users.mock.calls[1][0].where.id).toEqual({ gt: "u0999" });
  });
});

describe("queueDailyReminders", () => {
  // The entitlement rule reads the real clock, so the contract spans it widely.
  const future = new Date("2099-08-01T00:00:00Z");
  const past = new Date("2000-08-01T00:00:00Z");
  const base = { role: "STUDENT", subscription: null, studentMembership: null };

  it("points paid students at practice and free students at the Daily Challenge, keyed by day", async () => {
    users.mockResolvedValueOnce([
      { ...base, id: "p", email: "p@x.com", firstName: "Pat", subscription: { status: "ACTIVE" } },
      { ...base, id: "f", email: "f@x.com", firstName: "Fay" },
    ]);

    expect(await queueDailyReminders(new Date("2026-09-21T22:00:00Z"))).toBe(2);

    const [paid, free] = queued();
    expect(paid.body).toContain("/practice");
    expect(free.body).toContain("/daily");
    expect(tx.emailSend.createManyAndReturn.mock.calls[0][0].data).toContainEqual({
      userId: "f",
      kind: "daily_reminder",
      day: "2026-09-21",
    });
  });

  it("points a student their district covers at practice, not the free Daily Challenge", async () => {
    users.mockResolvedValueOnce([
      {
        ...base,
        id: "d",
        email: "d@school.edu",
        firstName: "Dee",
        studentMembership: {
          status: "ACTIVE",
          expectedGraduationYear: 2099,
          organization: { status: "ACTIVE", contractStartDate: past, contractEndDate: future },
        },
      },
    ]);

    await queueDailyReminders(new Date("2026-09-21T22:00:00Z"));

    expect(queued()[0].body).toContain("/practice");
  });

  it("skips a student who answered anything today, in any mode", async () => {
    users.mockResolvedValueOnce([
      { ...base, id: "busy", email: "busy@x.com", firstName: "Bo" },
      { ...base, id: "idle", email: "idle@x.com", firstName: "Ida" },
    ]);
    activeSince.mockResolvedValueOnce(new Set(["busy"]));

    expect(await queueDailyReminders(new Date("2026-09-21T22:00:00Z"))).toBe(1);

    expect(activeSince).toHaveBeenCalledWith(["busy", "idle"], new Date("2026-09-21T00:00:00Z"));
    expect(queued().map((r) => r.to)).toEqual(["idle@x.com"]);
  });

  it("asks for nothing more when there is nobody to remind", async () => {
    users.mockResolvedValueOnce([]);
    expect(await queueDailyReminders()).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });
});
