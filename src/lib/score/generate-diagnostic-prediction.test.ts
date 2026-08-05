import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDiagnosticPrediction } from "@/lib/score/generate-diagnostic-prediction";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    predictionHistoryEntry: { findFirst: vi.fn(), create: vi.fn() },
    diagnosticSession: { findUnique: vi.fn() },
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  predictionHistoryEntry: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.predictionHistoryEntry.findFirst.mockResolvedValue(null);
  mocked.predictionHistoryEntry.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "pred1",
    ...data,
  }));
});

function fullDiagnosticAttempts(isCorrect: boolean) {
  return ALL_CATEGORIES.flatMap((category) => [
    { category, difficulty: "EASY", isCorrect },
    { category, difficulty: "MEDIUM", isCorrect },
    { category, difficulty: "HARD", isCorrect },
  ]);
}

describe("generateDiagnosticPrediction", () => {
  it("is idempotent — returns the existing DIAGNOSTIC entry without recomputing", async () => {
    const existing = { id: "existing-pred" };
    mocked.predictionHistoryEntry.findFirst.mockResolvedValue(existing);

    const result = await generateDiagnosticPrediction("student1");

    expect(result).toBe(existing);
    expect(mocked.diagnosticSession.findUnique).not.toHaveBeenCalled();
  });

  it("throws DIAGNOSTIC_INCOMPLETE when no diagnostic session exists", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue(null);

    await expect(generateDiagnosticPrediction("student1")).rejects.toThrow(/diagnostic/i);
  });

  it("throws DIAGNOSTIC_INCOMPLETE when the session is still IN_PROGRESS", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({ status: "IN_PROGRESS", attempts: [] });

    await expect(generateDiagnosticPrediction("student1")).rejects.toThrow();
  });

  it("throws DIAGNOSTIC_INCOMPLETE when a category is missing one of its three difficulty results", async () => {
    const attempts = fullDiagnosticAttempts(true).filter(
      (a) => !(a.category === ALL_CATEGORIES[0] && a.difficulty === "HARD"),
    );
    mocked.diagnosticSession.findUnique.mockResolvedValue({ status: "COMPLETED", attempts });

    await expect(generateDiagnosticPrediction("student1")).rejects.toThrow(new RegExp(ALL_CATEGORIES[0]));
  });

  it("generates a DIAGNOSTIC prediction with null sourceSetId and populated internalDiagnosticEstimate for a perfect diagnostic", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({ status: "COMPLETED", attempts: fullDiagnosticAttempts(true) });

    const result = (await generateDiagnosticPrediction("student1")) as {
      sourceType: string;
      sourceSetId: string | null;
      internalDiagnosticEstimate: number;
      displayedRangeMinimum: number;
      approximateImprovement: number;
    };

    expect(result.sourceType).toBe("DIAGNOSTIC");
    expect(result.sourceSetId).toBeNull();
    expect(result.internalDiagnosticEstimate).toBe(1600);
    expect(result.displayedRangeMinimum).toBe(1530);
    expect(result.approximateImprovement).toBe(0);
  });
});
