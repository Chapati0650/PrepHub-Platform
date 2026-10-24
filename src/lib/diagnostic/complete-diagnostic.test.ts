import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeDiagnostic, finalizeDiagnosticCompletion } from "@/lib/diagnostic/complete-diagnostic";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { prisma } from "@/lib/prisma";
import { generatePracticeSet } from "@/lib/adaptive/generate-practice-set";
import { generateDiagnosticPrediction } from "@/lib/score/generate-diagnostic-prediction";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    diagnosticSession: { findUnique: vi.fn(), update: vi.fn() },
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
  mocked.diagnosticSession.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "session1",
    status: "COMPLETED",
    ...data,
  }));
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

  it("creates seven Category States from the diagnostic pattern and marks the session completed", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      id: "session1",
      status: "IN_PROGRESS",
      attempts: fullyAnsweredAttempts(true),
    });

    const result = (await completeDiagnostic("student1")) as { status: string };

    expect(mocked.categoryState.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.objectContaining({ ability: 90, initialAbility: 90 })]),
        skipDuplicates: true,
      }),
    );
    const createdStates = mocked.categoryState.createMany.mock.calls[0][0].data;
    expect(createdStates).toHaveLength(7);
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
  it("completes without the Hard questions a student didn't earn, scoring them as wrong", async () => {
    // Every Medium missed: no bonus round was earned, so the seven Hard
    // questions were never served and must not hold up completion.
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      id: "session1",
      status: "IN_PROGRESS",
      format: "STAGED",
      attempts: stagedCoreDone(false),
    });

    await completeDiagnostic("student1");

    const rows = mocked.categoryState.createMany.mock.calls[0][0].data as { ability: number }[];
    // E1 M0 H0 in every category — the Hard questions count as misses.
    expect(rows.every((r) => r.ability === 40)).toBe(true);
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

