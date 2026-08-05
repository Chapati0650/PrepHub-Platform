import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectQuestionForSlot } from "@/lib/adaptive/question-selection";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    question: { findMany: vi.fn() },
    finalizedAttempt: { findMany: vi.fn() },
    diagnosticAttempt: { findMany: vi.fn() },
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  question: Record<string, ReturnType<typeof vi.fn>>;
  finalizedAttempt: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticAttempt: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.finalizedAttempt.findMany.mockResolvedValue([]);
  mocked.diagnosticAttempt.findMany.mockResolvedValue([]);
});

function fixedRandom(...values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe("selectQuestionForSlot", () => {
  it("selects from Tier 1 (unseen questions) when Tier 1 is not empty", async () => {
    mocked.question.findMany.mockResolvedValue([
      { id: "q1", familyId: null, currentPublishedRevisionId: "r1" },
      { id: "q2", familyId: null, currentPublishedRevisionId: "r2" },
    ]);
    // Both unanswered -> both Tier 1.

    const result = await selectQuestionForSlot({
      studentId: "s1",
      plannedCategory: "ALGEBRA",
      plannedDifficulty: "MEDIUM",
      excludeQuestionIds: new Set(),
      excludeFamilyIds: new Set(),
      random: fixedRandom(0),
    });

    expect(result).toMatchObject({ questionId: "q1", questionRevisionId: "r1", category: "ALGEBRA", difficulty: "MEDIUM" });
  });

  it("falls back to Tier 2 only when Tier 1 is empty, preferring the least recently answered", async () => {
    mocked.question.findMany.mockResolvedValue([
      { id: "q1", familyId: null, currentPublishedRevisionId: "r1" },
      { id: "q2", familyId: null, currentPublishedRevisionId: "r2" },
    ]);
    mocked.finalizedAttempt.findMany.mockResolvedValue([
      { questionId: "q1", finalizedAt: new Date("2026-01-01") }, // oldest -> should be preferred
      { questionId: "q2", finalizedAt: new Date("2026-06-01") },
    ]);

    const result = await selectQuestionForSlot({
      studentId: "s1",
      plannedCategory: "ALGEBRA",
      plannedDifficulty: "MEDIUM",
      excludeQuestionIds: new Set(),
      excludeFamilyIds: new Set(),
      random: fixedRandom(0),
    });

    expect(result?.questionId).toBe("q1");
  });

  it("excludes questions already selected in the current set", async () => {
    mocked.question.findMany.mockResolvedValue([
      { id: "q1", familyId: null, currentPublishedRevisionId: "r1" },
      { id: "q2", familyId: null, currentPublishedRevisionId: "r2" },
    ]);

    const result = await selectQuestionForSlot({
      studentId: "s1",
      plannedCategory: "ALGEBRA",
      plannedDifficulty: "MEDIUM",
      excludeQuestionIds: new Set(["q1"]),
      excludeFamilyIds: new Set(),
      random: fixedRandom(0),
    });

    expect(result?.questionId).toBe("q2");
  });

  it("excludes questions belonging to an already-selected Question Family", async () => {
    mocked.question.findMany.mockResolvedValue([
      { id: "q1", familyId: "fam1", currentPublishedRevisionId: "r1" },
      { id: "q2", familyId: null, currentPublishedRevisionId: "r2" },
    ]);

    const result = await selectQuestionForSlot({
      studentId: "s1",
      plannedCategory: "ALGEBRA",
      plannedDifficulty: "MEDIUM",
      excludeQuestionIds: new Set(),
      excludeFamilyIds: new Set(["fam1"]),
      random: fixedRandom(0),
    });

    expect(result?.questionId).toBe("q2");
  });

  it("falls back to Medium then Hard when no Easy question is available for a planned Easy slot", async () => {
    mocked.question.findMany.mockImplementation(({ where }: { where: { difficulty: string } }) => {
      if (where.difficulty === "EASY") return Promise.resolve([]);
      if (where.difficulty === "MEDIUM") return Promise.resolve([{ id: "qm", familyId: null, currentPublishedRevisionId: "rm" }]);
      return Promise.resolve([]);
    });

    const result = await selectQuestionForSlot({
      studentId: "s1",
      plannedCategory: "ALGEBRA",
      plannedDifficulty: "EASY",
      excludeQuestionIds: new Set(),
      excludeFamilyIds: new Set(),
      random: fixedRandom(0),
    });

    expect(result).toMatchObject({ questionId: "qm", difficulty: "MEDIUM", category: "ALGEBRA" });
  });

  it("returns null when no eligible question exists at any fallback difficulty", async () => {
    mocked.question.findMany.mockResolvedValue([]);

    const result = await selectQuestionForSlot({
      studentId: "s1",
      plannedCategory: "ALGEBRA",
      plannedDifficulty: "EASY",
      excludeQuestionIds: new Set(),
      excludeFamilyIds: new Set(),
      random: fixedRandom(0),
    });

    expect(result).toBeNull();
  });
});
