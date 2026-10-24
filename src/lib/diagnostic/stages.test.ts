import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { advanceDiagnostic, convertLegacySession, settleBonusRound } from "@/lib/diagnostic/stages";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { DIAGNOSTIC_SEQUENCE } from "@/lib/diagnostic/sequence";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    diagnosticSession: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    diagnosticAttempt: { findMany: vi.fn(), updateMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  // Interactive transactions run against the same mock, so the assertions
  // read as plain calls while exercising the transactional path.
  (mockPrisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(mockPrisma),
  );
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticAttempt: Record<string, ReturnType<typeof vi.fn>>;
  $executeRaw: ReturnType<typeof vi.fn>;
};

type Row = {
  id: string;
  position: number;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  submittedAt: Date | null;
  isCorrect: boolean | null;
  waivedAt: Date | null;
};

function row(
  category: QuestionCategory,
  difficulty: QuestionDifficulty,
  position: number,
  state: "open" | "right" | "wrong" = "open",
): Row {
  return {
    id: `${category}-${difficulty}`,
    position,
    category,
    difficulty,
    submittedAt: state === "open" ? null : new Date(),
    isCorrect: state === "open" ? null : state === "right",
    waivedAt: null,
  };
}

/** The old fixed order: category, then Easy/Medium/Hard. */
function legacyAttempts(answered: Partial<Record<string, "right" | "wrong">> = {}): Row[] {
  return ALL_CATEGORIES.flatMap((category, c) =>
    (["EASY", "MEDIUM", "HARD"] as const).map((difficulty, d) =>
      row(category, difficulty, c * 3 + d, answered[`${category}-${difficulty}`] ?? "open"),
    ),
  );
}

/** A staged session with the core finished and the given Mediums right. */
function coreFinished(rightMediums: QuestionCategory[]): Row[] {
  return DIAGNOSTIC_SEQUENCE.map((slot, position) => {
    if (slot.difficulty === "EASY") return row(slot.category, "EASY", position, "right");
    if (slot.difficulty === "MEDIUM") {
      return row(slot.category, "MEDIUM", position, rightMediums.includes(slot.category) ? "right" : "wrong");
    }
    return row(slot.category, "HARD", position);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.diagnosticSession.updateMany.mockResolvedValue({ count: 1 });
  mocked.diagnosticAttempt.updateMany.mockResolvedValue({ count: 0 });
});

describe("convertLegacySession", () => {
  it("re-sequences an in-progress legacy session onto the staged order", async () => {
    mocked.diagnosticAttempt.findMany.mockResolvedValue(legacyAttempts());

    await convertLegacySession("session1");

    expect(mocked.diagnosticSession.updateMany).toHaveBeenCalledWith({
      where: { id: "session1", format: "FULL_21", status: "IN_PROGRESS" },
      data: { format: "STAGED" },
    });
    // Two statements — clear the range, then land it — not one per row.
    expect(mocked.$executeRaw).toHaveBeenCalledTimes(2);

    // The landing statement carries the staged order: the first row it
    // places at position 0 is the new opener, not Reading Comprehension. The
    // VALUES list arrives as a Prisma.Sql fragment, whose bound parameters
    // are its `values`, in order: id, position, id, position...
    const fragment = mocked.$executeRaw.mock.calls[1]
      .slice(1)
      .find((arg: unknown): arg is { values: unknown[] } => Array.isArray((arg as { values?: unknown })?.values));
    expect(fragment?.values.slice(0, 2)).toEqual([
      `${DIAGNOSTIC_SEQUENCE[0].category}-${DIAGNOSTIC_SEQUENCE[0].difficulty}`,
      0,
    ]);
  });

  it("resumes the student on their first unanswered core question", async () => {
    // Answered the old opening's first two: Reading Easy and Medium.
    mocked.diagnosticAttempt.findMany.mockResolvedValue(
      legacyAttempts({ "READING_COMPREHENSION-EASY": "right", "READING_COMPREHENSION-MEDIUM": "wrong" }),
    );

    await convertLegacySession("session1");

    // Neither answered question is the staged opener, so they resume at 0.
    expect(mocked.diagnosticSession.update).toHaveBeenCalledWith({
      where: { id: "session1" },
      data: { currentPosition: 0 },
    });
  });

  it("does nothing when another request already converted the session", async () => {
    mocked.diagnosticSession.updateMany.mockResolvedValue({ count: 0 });

    await convertLegacySession("session1");

    expect(mocked.$executeRaw).not.toHaveBeenCalled();
    expect(mocked.diagnosticSession.update).not.toHaveBeenCalled();
  });
});

describe("settleBonusRound", () => {
  it("waives the unearned Hard questions, guarded against a racing answer", async () => {
    mocked.diagnosticAttempt.findMany.mockResolvedValue(coreFinished(["ALGEBRA"]));

    await settleBonusRound("session1");

    const call = mocked.diagnosticAttempt.updateMany.mock.calls[0][0];
    expect(call.where.id.in).toHaveLength(6);
    expect(call.where.id.in).not.toContain("ALGEBRA-HARD");
    expect(call.where).toMatchObject({ submittedAt: null, waivedAt: null });
    expect(call.data.waivedAt).toBeInstanceOf(Date);
  });

  it("writes nothing while the core is unfinished", async () => {
    const attempts = coreFinished([]);
    attempts[0].submittedAt = null;
    mocked.diagnosticAttempt.findMany.mockResolvedValue(attempts);

    await settleBonusRound("session1");

    expect(mocked.diagnosticAttempt.updateMany).not.toHaveBeenCalled();
  });
});

describe("advanceDiagnostic", () => {
  it("reports how many core questions are left when the core isn't finished", async () => {
    const attempts = coreFinished([]);
    attempts[0].submittedAt = null;
    attempts[1].submittedAt = null;
    mocked.diagnosticSession.findUnique.mockResolvedValue({ id: "session1", attempts });

    expect(await advanceDiagnostic("student1")).toEqual({ kind: "CORE_INCOMPLETE", unanswered: 2 });
  });

  it("opens the bonus round when a Hard question was earned, starting it at the top", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      id: "session1",
      attempts: coreFinished(["ALGEBRA", "GRAMMAR"]),
    });
    mocked.diagnosticAttempt.findMany.mockResolvedValue(coreFinished(["ALGEBRA", "GRAMMAR"]));

    expect(await advanceDiagnostic("student1")).toEqual({ kind: "BONUS", remaining: 2 });
    // The core left currentPosition at its own last index; the bonus runner
    // indexes a different list and must open on its first question.
    expect(mocked.diagnosticSession.update).toHaveBeenCalledWith({
      where: { id: "session1" },
      data: { currentPosition: 0 },
    });
  });

  it("goes straight to DONE for a student who earned no bonus questions", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({ id: "session1", attempts: coreFinished([]) });
    mocked.diagnosticAttempt.findMany.mockResolvedValue(coreFinished([]));

    expect(await advanceDiagnostic("student1")).toEqual({ kind: "DONE" });
  });

  it("doesn't reset the position of a bonus round already under way", async () => {
    const attempts = coreFinished(["ALGEBRA", "GRAMMAR"]);
    const algebraHard = attempts.find((a) => a.id === "ALGEBRA-HARD")!;
    algebraHard.submittedAt = new Date();
    algebraHard.isCorrect = true;
    mocked.diagnosticSession.findUnique.mockResolvedValue({ id: "session1", attempts });
    mocked.diagnosticAttempt.findMany.mockResolvedValue(attempts);

    expect(await advanceDiagnostic("student1")).toEqual({ kind: "BONUS", remaining: 1 });
    expect(mocked.diagnosticSession.update).not.toHaveBeenCalled();
  });
});
