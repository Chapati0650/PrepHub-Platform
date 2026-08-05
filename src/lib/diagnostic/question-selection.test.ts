import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectDiagnosticQuestion } from "@/lib/diagnostic/question-selection";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = { question: { findMany: vi.fn() } };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as { question: Record<string, ReturnType<typeof vi.fn>> };

beforeEach(() => {
  vi.clearAllMocks();
});

function fixedRandom(value: number) {
  return () => value;
}

describe("selectDiagnosticQuestion", () => {
  it("selects a published question matching the exact category and difficulty", async () => {
    mocked.question.findMany.mockResolvedValue([{ id: "q1", currentPublishedRevisionId: "r1" }]);

    const result = await selectDiagnosticQuestion({
      category: "ALGEBRA",
      difficulty: "EASY",
      excludeQuestionIds: new Set(),
      random: fixedRandom(0),
    });

    expect(result).toEqual({ questionId: "q1", questionRevisionId: "r1" });
  });

  it("excludes already-selected questions", async () => {
    mocked.question.findMany.mockResolvedValue([
      { id: "q1", currentPublishedRevisionId: "r1" },
      { id: "q2", currentPublishedRevisionId: "r2" },
    ]);

    const result = await selectDiagnosticQuestion({
      category: "ALGEBRA",
      difficulty: "EASY",
      excludeQuestionIds: new Set(["q1"]),
      random: fixedRandom(0),
    });

    expect(result?.questionId).toBe("q2");
  });

  it("returns null with no fallback to another difficulty when no eligible question exists", async () => {
    mocked.question.findMany.mockResolvedValue([]);

    const result = await selectDiagnosticQuestion({
      category: "ALGEBRA",
      difficulty: "EASY",
      excludeQuestionIds: new Set(),
      random: fixedRandom(0),
    });

    expect(result).toBeNull();
    // Only ever queries the exact requested difficulty — no fallback calls.
    expect(mocked.question.findMany).toHaveBeenCalledTimes(1);
    expect(mocked.question.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ difficulty: "EASY" }) }),
    );
  });
});
