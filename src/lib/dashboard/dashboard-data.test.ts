import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDashboardData } from "@/lib/dashboard/dashboard-data";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    user: { findUniqueOrThrow: vi.fn() },
    diagnosticSession: { findUnique: vi.fn() },
    predictionHistoryEntry: { findFirst: vi.fn(), findMany: vi.fn() },
    finalizedAttempt: { count: vi.fn(), findMany: vi.fn() },
    diagnosticAttempt: { count: vi.fn(), findMany: vi.fn() },
    practiceSet: { findMany: vi.fn(), findFirst: vi.fn() },
    categoryState: { findMany: vi.fn() },
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  user: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
  predictionHistoryEntry: Record<string, ReturnType<typeof vi.fn>>;
  finalizedAttempt: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticAttempt: Record<string, ReturnType<typeof vi.fn>>;
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  categoryState: Record<string, ReturnType<typeof vi.fn>>;
};

function categoryStatesAt(ability: number) {
  return ALL_CATEGORIES.map((category) => ({ category, ability }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.user.findUniqueOrThrow.mockResolvedValue({ firstName: "Prithviraj" });
  mocked.finalizedAttempt.count.mockResolvedValue(0);
  mocked.diagnosticAttempt.count.mockResolvedValue(0);
  mocked.finalizedAttempt.findMany.mockResolvedValue([]);
  mocked.diagnosticAttempt.findMany.mockResolvedValue([]);
  mocked.practiceSet.findMany.mockResolvedValue([]);
  mocked.practiceSet.findFirst.mockResolvedValue(null);
  mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(50));
  mocked.predictionHistoryEntry.findMany.mockResolvedValue([]);
});

describe("getDashboardData", () => {
  it("reports NOT_STARTED with empty stats when no diagnostic session exists", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue(null);

    const result = await getDashboardData("student1");

    expect(result.diagnosticStatus).toBe("NOT_STARTED");
    expect(result.currentRange).toBeNull();
    expect(result.mastery).toEqual([]);
  });

  it("reports IN_PROGRESS when a diagnostic session exists but isn't completed", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({ status: "IN_PROGRESS" });

    const result = await getDashboardData("student1");

    expect(result.diagnosticStatus).toBe("IN_PROGRESS");
  });

  it("computes approximate improvement since the diagnostic baseline", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      status: "COMPLETED",
      startedAt: new Date("2026-01-01"),
      completedAt: new Date("2026-01-01"),
    });
    mocked.predictionHistoryEntry.findFirst
      .mockResolvedValueOnce({ displayedRangeMinimum: 810, displayedRangeMaximum: 880, representativeMidpoint: 845 }) // latest
      .mockResolvedValueOnce({ representativeMidpoint: 605 }); // diagnostic baseline

    const result = await getDashboardData("student1");

    expect(result.currentRange).toEqual({ min: 810, max: 880 });
    expect(result.approximateImprovementSinceStart).toBe(240);
  });

  it("flags a recent SAT improvement when the two most recent predictions increased", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
    });
    mocked.predictionHistoryEntry.findFirst
      .mockResolvedValueOnce({ displayedRangeMinimum: 810, displayedRangeMaximum: 880, representativeMidpoint: 845 })
      .mockResolvedValueOnce({ representativeMidpoint: 605 });
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      { representativeMidpoint: 845 },
      { representativeMidpoint: 765 }, // previous, lower -> +80 improvement
    ]);

    const result = await getDashboardData("student1");

    expect(result.recentImprovements).toContain("Estimated SAT increased by 80 points.");
  });

  it("flags category mastery improvements from the most recently completed set's snapshot", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
    });
    mocked.predictionHistoryEntry.findFirst
      .mockResolvedValueOnce({ displayedRangeMinimum: 810, displayedRangeMaximum: 880, representativeMidpoint: 845 })
      .mockResolvedValueOnce({ representativeMidpoint: 845 });
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(55)); // +5 from snapshot below
    mocked.practiceSet.findFirst.mockResolvedValue({
      categorySnapshots: [{ category: "ALGEBRA", abilityAtGeneration: 50 }],
    });

    const result = await getDashboardData("student1");

    expect(result.recentImprovements).toContain("Algebra mastery improved.");
  });

  it("does not extend the streak or count activity when no attempts exist", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
    });
    mocked.predictionHistoryEntry.findFirst.mockResolvedValue(null);

    const result = await getDashboardData("student1");

    expect(result.studyStreak).toBe(0);
    expect(result.totalQuestionsAnswered).toBe(0);
  });
});
