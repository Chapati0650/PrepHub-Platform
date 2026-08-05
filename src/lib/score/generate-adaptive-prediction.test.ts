import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAdaptivePrediction } from "@/lib/score/generate-adaptive-prediction";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    predictionHistoryEntry: { findFirst: vi.fn(), create: vi.fn() },
    practiceSet: { findUnique: vi.fn() },
    categoryState: { findMany: vi.fn() },
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  predictionHistoryEntry: Record<string, ReturnType<typeof vi.fn>>;
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  categoryState: Record<string, ReturnType<typeof vi.fn>>;
};

function completedSet(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "set1",
    studentId: "student1",
    status: "COMPLETED",
    finalizedAttempts: Array.from({ length: 21 }, (_, i) => ({ id: `fa${i}` })),
    ...overrides,
  };
}

function categoryStatesAt(ability: number) {
  return ALL_CATEGORIES.map((category) => ({ category, ability }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.predictionHistoryEntry.findFirst.mockReset();
  mocked.predictionHistoryEntry.findFirst
    .mockResolvedValueOnce(null) // idempotency check
    .mockResolvedValueOnce({ representativeMidpoint: 440 }); // initial diagnostic baseline
  mocked.practiceSet.findUnique.mockResolvedValue(completedSet());
  mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(100));
  mocked.predictionHistoryEntry.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "pred2",
    ...data,
  }));
});

describe("generateAdaptivePrediction", () => {
  it("is idempotent — returns the existing entry for this set instead of recomputing", async () => {
    mocked.predictionHistoryEntry.findFirst.mockReset();
    const existing = { id: "existing-pred" };
    mocked.predictionHistoryEntry.findFirst.mockResolvedValue(existing);

    const result = await generateAdaptivePrediction("student1", "set1");

    expect(result).toBe(existing);
    expect(mocked.practiceSet.findUnique).not.toHaveBeenCalled();
  });

  it("throws SET_INCOMPLETE when the practice set is not COMPLETED", async () => {
    mocked.practiceSet.findUnique.mockResolvedValue(completedSet({ status: "ACTIVE" }));

    await expect(generateAdaptivePrediction("student1", "set1")).rejects.toThrow(/complet/i);
  });

  it("throws SET_INCOMPLETE when fewer than 21 answers are finalized", async () => {
    mocked.practiceSet.findUnique.mockResolvedValue(completedSet({ finalizedAttempts: Array(20).fill({}) }));

    await expect(generateAdaptivePrediction("student1", "set1")).rejects.toThrow(/21/);
  });

  it("throws DIAGNOSTIC_INCOMPLETE when no initial diagnostic prediction exists as a baseline", async () => {
    mocked.predictionHistoryEntry.findFirst.mockReset();
    mocked.predictionHistoryEntry.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(generateAdaptivePrediction("student1", "set1")).rejects.toThrow(/diagnostic/i);
  });

  it("throws CATEGORY_STATE_MISSING when fewer than seven Category States exist", async () => {
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(100).slice(0, 6));

    await expect(generateAdaptivePrediction("student1", "set1")).rejects.toThrow();
  });

  it("throws INVALID_ABILITY when an Ability Score is out of the 0-100 range", async () => {
    const states = categoryStatesAt(100);
    states[0].ability = 150;
    mocked.categoryState.findMany.mockResolvedValue(states);

    await expect(generateAdaptivePrediction("student1", "set1")).rejects.toThrow();
  });

  it("generates an ADAPTIVE_SET prediction with null internalDiagnosticEstimate and the sourceSetId set", async () => {
    const result = (await generateAdaptivePrediction("student1", "set1")) as {
      sourceType: string;
      sourceSetId: string;
      internalDiagnosticEstimate: number | null;
      overallAbility: number;
      approximateImprovement: number;
    };

    expect(result.sourceType).toBe("ADAPTIVE_SET");
    expect(result.sourceSetId).toBe("set1");
    expect(result.internalDiagnosticEstimate).toBeNull();
    expect(result.overallAbility).toBe(100);
    // Baseline midpoint 440 (bottom range); ability 100 -> top range midpoint 1565.
    expect(result.approximateImprovement).toBe(1125);
  });
});
