import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeDiagnostic, finalizeDiagnosticCompletion } from "@/lib/diagnostic/complete-diagnostic";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { abilitiesFromHistory } from "@/lib/adaptive/diagnostic-initialization";
import { prisma } from "@/lib/prisma";
import { generatePracticeSet } from "@/lib/adaptive/generate-practice-set";
import { generateDiagnosticPrediction } from "@/lib/score/generate-diagnostic-prediction";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    diagnosticSession: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    categoryState: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  (mockPrisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation((arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(mockPrisma);
    return Promise.all(arg as Promise<unknown>[]);
  });
  return { prisma: mockPrisma };
});

vi.mock("@/lib/adaptive/generate-practice-set", () => ({ generatePracticeSet: vi.fn() }));
// The waiving step is exercised in stages.test.ts; here it only has to run.
vi.mock("@/lib/diagnostic/stages", () => ({ settleBonusRound: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/score/generate-diagnostic-prediction", () => ({ generateDiagnosticPrediction: vi.fn() }));

const mocked = prisma as unknown as {
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
  categoryState: Record<string, ReturnType<typeof vi.fn>>;
};

/** A staged session: core answered, Mediums as given, Hard questions untouched. */
function stagedCoreDone(mediumRight: boolean) {
  return ALL_CATEGORIES.flatMap((category, i) => [
    { id: `e${i}`, category, difficulty: "EASY", isCorrect: true, submittedAt: new Date(), waivedAt: null },
    { id: `m${i}`, category, difficulty: "MEDIUM", isCorrect: mediumRight, submittedAt: new Date(), waivedAt: null },
    { id: `h${i}`, category, difficulty: "HARD", isCorrect: null, submittedAt: null, waivedAt: null },
  ]);
}

function fullyAnsweredAttempts(isCorrect: boolean) {
  return ALL_CATEGORIES.flatMap((category) => [
    { category, difficulty: "EASY", isCorrect, submittedAt: new Date() },
    { category, difficulty: "MEDIUM", isCorrect, submittedAt: new Date() },
    { category, difficulty: "HARD", isCorrect, submittedAt: new Date() },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  // This request wins the claim unless a test says otherwise.
  mocked.diagnosticSession.updateMany.mockResolvedValue({ count: 1 });
  mocked.diagnosticSession.findUniqueOrThrow.mockResolvedValue({ id: "session1", status: "COMPLETED", completedAt: new Date() });
});

describe("completeDiagnostic", () => {
  it("throws SESSION_NOT_FOUND when no session exists", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue(null);

    await expect(completeDiagnostic("student1")).rejects.toThrow(/not found/i);
  });

  it("is idempotent — returns the session unchanged if already completed", async () => {
    const completed = { status: "COMPLETED" };
    mocked.diagnosticSession.findUnique.mockResolvedValue(completed);

    const result = await completeDiagnostic("student1");

    expect(result).toBe(completed);
    expect(mocked.categoryState.createMany).not.toHaveBeenCalled();
  });

  it("throws QUESTIONS_REMAIN when any attempt is unsubmitted", async () => {
    const attempts = fullyAnsweredAttempts(true);
    attempts[0] = { ...attempts[0], submittedAt: null as unknown as Date };
    mocked.diagnosticSession.findUnique.mockResolvedValue({ id: "session1", status: "IN_PROGRESS", attempts });

    await expect(completeDiagnostic("student1")).rejects.toThrow(/unanswered/i);
    expect(mocked.categoryState.createMany).not.toHaveBeenCalled();
  });

  it("creates seven Category States from the diagnostic answers and marks the session completed", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      id: "session1",
      status: "IN_PROGRESS",
      attempts: fullyAnsweredAttempts(true),
    });

    const result = (await completeDiagnostic("student1")) as { status: string };

    // The estimate every Practice Set uses, from all twenty-one right answers
    // and starting at the top for a perfect section: the initial ability is the ability.
    const expected = abilitiesFromHistory(
      ALL_CATEGORIES.flatMap((category) =>
        (["EASY", "MEDIUM", "HARD"] as const).map((difficulty) => ({ category, difficulty, isCorrect: true })),
      ),
    );
    expect(mocked.categoryState.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    const createdStates = mocked.categoryState.createMany.mock.calls[0][0].data as {
      category: (typeof ALL_CATEGORIES)[number];
      ability: number;
      initialAbility: number;
    }[];
    expect(createdStates).toHaveLength(7);
    for (const state of createdStates) {
      expect(state.ability).toBe(expected[state.category]);
      expect(state.initialAbility).toBe(state.ability);
      expect(state.ability).toBeGreaterThan(50);
    }
    expect(mocked.diagnosticSession.updateMany).toHaveBeenCalledWith({
      where: { id: "session1", status: "IN_PROGRESS" },
      data: expect.objectContaining({ status: "COMPLETED", completedAt: expect.any(Date) }),
    });
    expect(result.status).toBe("COMPLETED");
  });

  it("does nothing more when a concurrent completion already claimed the session", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      id: "session1",
      status: "IN_PROGRESS",
      attempts: fullyAnsweredAttempts(true),
    });
    mocked.diagnosticSession.updateMany.mockResolvedValue({ count: 0 });

    const result = (await completeDiagnostic("student1")) as { status: string };

    expect(mocked.categoryState.createMany).not.toHaveBeenCalled();
    expect(result.status).toBe("COMPLETED");
  });
});

describe("finalizeDiagnosticCompletion", () => {
  it("completes the diagnostic, generates the prediction, and pre-generates the next practice set", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      id: "session1",
      status: "IN_PROGRESS",
      attempts: fullyAnsweredAttempts(true),
    });
    vi.mocked(generateDiagnosticPrediction).mockResolvedValue({ id: "pred1" } as never);
    vi.mocked(generatePracticeSet).mockResolvedValue({ id: "set1" } as never);

    const result = await finalizeDiagnosticCompletion("student1");

    expect(result.prediction).toEqual({ id: "pred1" });
    expect(generatePracticeSet).toHaveBeenCalledWith("student1");
  });

  it("does not let a practice-set generation failure block diagnostic completion", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      id: "session1",
      status: "IN_PROGRESS",
      attempts: fullyAnsweredAttempts(true),
    });
    vi.mocked(generateDiagnosticPrediction).mockResolvedValue({ id: "pred1" } as never);
    vi.mocked(generatePracticeSet).mockRejectedValue(new Error("no published content yet"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await finalizeDiagnosticCompletion("student1");

    expect(result.prediction).toEqual({ id: "pred1" });
    expect(result.session.status).toBe("COMPLETED");
  });
});

describe("completeDiagnostic — staged format", () => {
  it("completes without the Hard questions a student didn't earn, and doesn't count them at all", async () => {
    // Every Medium missed: no bonus round was earned, so the seven Hard
    // questions were never served and must not hold up completion.
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      id: "session1",
      status: "IN_PROGRESS",
      format: "STAGED",
      attempts: stagedCoreDone(false),
    });

    await completeDiagnostic("student1");

    const rows = mocked.categoryState.createMany.mock.calls[0][0].data as {
      category: (typeof ALL_CATEGORIES)[number];
      ability: number;
    }[];
    // Easy right, Medium wrong, in every category; the unserved Hard
    // questions are no evidence either way (they were once scored as misses).
    const expected = abilitiesFromHistory(
      ALL_CATEGORIES.flatMap((category) => [
        { category, difficulty: "EASY" as const, isCorrect: true },
        { category, difficulty: "MEDIUM" as const, isCorrect: false },
      ]),
    );
    for (const row of rows) expect(row.ability).toBe(expected[row.category]);
  });

  it("refuses to complete while an earned bonus question is still unanswered", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      id: "session1",
      status: "IN_PROGRESS",
      format: "STAGED",
      attempts: stagedCoreDone(true),
    });

    await expect(completeDiagnostic("student1")).rejects.toMatchObject({ code: "QUESTIONS_REMAIN" });
    expect(mocked.categoryState.createMany).not.toHaveBeenCalled();
  });
});

