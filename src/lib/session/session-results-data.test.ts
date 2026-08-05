import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDiagnosticResultsData, getPracticeSetResultsData } from "@/lib/session/session-results-data";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    diagnosticSession: { findUniqueOrThrow: vi.fn() },
    practiceSet: { findUniqueOrThrow: vi.fn() },
    predictionHistoryEntry: { findFirstOrThrow: vi.fn(), findFirst: vi.fn() },
    categoryState: { findMany: vi.fn() },
    user: { findUniqueOrThrow: vi.fn() },
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  predictionHistoryEntry: Record<string, ReturnType<typeof vi.fn>>;
  categoryState: Record<string, ReturnType<typeof vi.fn>>;
  user: Record<string, ReturnType<typeof vi.fn>>;
};

function categoryStatesAt(ability: number) {
  return ALL_CATEGORIES.map((category) => ({ category, ability }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.user.findUniqueOrThrow.mockResolvedValue({ targetScore: 1500 });
});

describe("getDiagnosticResultsData", () => {
  it("computes accuracy and time stats from the diagnostic session, with no previous range", async () => {
    const started = new Date("2026-01-01T00:00:00Z");
    const completed = new Date("2026-01-01T00:21:00Z"); // 21 minutes -> 60s/question
    mocked.diagnosticSession.findUniqueOrThrow.mockResolvedValue({
      startedAt: started,
      completedAt: completed,
      attempts: ALL_CATEGORIES.flatMap((category, i) => [
        { id: `a${i}e`, position: i * 3, category, isCorrect: true },
        { id: `a${i}m`, position: i * 3 + 1, category, isCorrect: false },
        { id: `a${i}h`, position: i * 3 + 2, category, isCorrect: true },
      ]),
    });
    mocked.predictionHistoryEntry.findFirstOrThrow.mockResolvedValue({ displayedRangeMinimum: 890, displayedRangeMaximum: 960 });
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(50));

    const result = await getDiagnosticResultsData("student1");

    expect(result.previousRange).toBeNull();
    expect(result.currentRange).toEqual({ min: 890, max: 960 });
    expect(result.stats.total).toBe(21);
    expect(result.stats.correct).toBe(14); // 2 of every 3 correct
    expect(result.stats.accuracy).toBe(Math.round((14 / 21) * 100));
    expect(result.stats.totalTimeSeconds).toBe(21 * 60);
    expect(result.stats.avgTimeSeconds).toBe(60);
    expect(result.mastery.every((m) => m.changeSinceStart === null)).toBe(true);
    expect(result.targetScore).toBe(1500);
  });
});

describe("getPracticeSetResultsData", () => {
  it("finds no previous range for a student's first-ever completed set", async () => {
    mocked.practiceSet.findUniqueOrThrow.mockResolvedValue({
      studentId: "student1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: new Date("2026-01-01T00:21:00Z"),
      slots: ALL_CATEGORIES.map((category, i) => ({
        id: `slot${i}`,
        position: i,
        resolvedCategory: category,
        finalizedAttempt: { isCorrect: true },
      })),
      categorySnapshots: ALL_CATEGORIES.map((category) => ({ category, abilityAtGeneration: 25 })),
    });
    mocked.predictionHistoryEntry.findFirstOrThrow.mockResolvedValue({
      displayedRangeMinimum: 730,
      displayedRangeMaximum: 800,
      approximateImprovement: 200,
      createdAt: new Date("2026-01-01T00:21:00Z"),
    });
    mocked.predictionHistoryEntry.findFirst.mockResolvedValue(null); // no earlier entry than the diagnostic itself
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(30));

    const result = await getPracticeSetResultsData("student1", "set1");

    expect(result.previousRange).toBeNull();
    expect(result.approximateImprovement).toBe(200);
  });

  it("computes a mastery delta per category from the generation-time snapshot to the current ability", async () => {
    mocked.practiceSet.findUniqueOrThrow.mockResolvedValue({
      studentId: "student1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: new Date("2026-01-01T00:21:00Z"),
      slots: ALL_CATEGORIES.map((category, i) => ({
        id: `slot${i}`,
        position: i,
        resolvedCategory: category,
        finalizedAttempt: { isCorrect: true },
      })),
      categorySnapshots: ALL_CATEGORIES.map((category) => ({ category, abilityAtGeneration: 40 })),
    });
    mocked.predictionHistoryEntry.findFirstOrThrow.mockResolvedValue({
      displayedRangeMinimum: 810,
      displayedRangeMaximum: 880,
      approximateImprovement: 40,
      createdAt: new Date("2026-01-01T00:21:00Z"),
    });
    mocked.predictionHistoryEntry.findFirst.mockResolvedValue({ displayedRangeMinimum: 730, displayedRangeMaximum: 800 });
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(45)); // +5 ability since generation

    const result = await getPracticeSetResultsData("student1", "set1");

    expect(result.previousRange).toEqual({ min: 730, max: 800 });
    for (const m of result.mastery) {
      expect(m.changeSinceStart).toBe(5);
      expect(m.currentMastery).toBe(45);
    }
  });

  it("throws when the practice set belongs to a different student", async () => {
    mocked.practiceSet.findUniqueOrThrow.mockResolvedValue({
      studentId: "someone-else",
      createdAt: new Date(),
      completedAt: new Date(),
      slots: [],
      categorySnapshots: [],
    });
    mocked.predictionHistoryEntry.findFirstOrThrow.mockResolvedValue({
      displayedRangeMinimum: 400,
      displayedRangeMaximum: 480,
      approximateImprovement: 0,
      createdAt: new Date(),
    });
    mocked.categoryState.findMany.mockResolvedValue([]);

    await expect(getPracticeSetResultsData("student1", "set1")).rejects.toThrow(/not found/i);
  });
});
