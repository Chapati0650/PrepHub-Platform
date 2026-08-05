import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSchoolAggregateStats } from "@/lib/school/aggregate-stats";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    studentMembership: { findMany: vi.fn() },
    finalizedAttempt: { findMany: vi.fn() },
    diagnosticAttempt: { findMany: vi.fn() },
    practiceSet: { findMany: vi.fn() },
    diagnosticSession: { findMany: vi.fn() },
    predictionHistoryEntry: { findMany: vi.fn() },
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  finalizedAttempt: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticAttempt: Record<string, ReturnType<typeof vi.fn>>;
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
  predictionHistoryEntry: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.finalizedAttempt.findMany.mockResolvedValue([]);
  mocked.diagnosticAttempt.findMany.mockResolvedValue([]);
  mocked.practiceSet.findMany.mockResolvedValue([]);
  mocked.diagnosticSession.findMany.mockResolvedValue([]);
  mocked.predictionHistoryEntry.findMany.mockResolvedValue([]);
});

describe("getSchoolAggregateStats", () => {
  it("returns the shared empty result when the school has no ACTIVE students", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([]);

    const result = await getSchoolAggregateStats("school1");

    expect(result.stats).toEqual({
      totalQuestionsAnswered: 0,
      totalStudyHours: 0,
      totalAdaptiveSessionsCompleted: 0,
      totalEstimatedSatPointsImproved: 0,
      activeStudentsThisWeek: 0,
      studyStreak: 0,
    });
    expect(result.questionsAnsweredToday).toBe(0);
    expect(result.studentsActiveToday).toBe(0);
  });

  it("scopes every query to only ACTIVE StudentMembership rows for the school", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);

    await getSchoolAggregateStats("school1");

    expect(mocked.studentMembership.findMany).toHaveBeenCalledWith({
      where: { schoolId: "school1", status: "ACTIVE" },
      select: { studentId: true },
    });
  });

  it("aggregates questions answered from both finalized adaptive attempts and diagnostic attempts", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    mocked.finalizedAttempt.findMany.mockResolvedValue([{ studentId: "s1", finalizedAt: new Date() }]);
    mocked.diagnosticAttempt.findMany.mockResolvedValue([
      { submittedAt: new Date(), diagnosticSession: { studentId: "s1" } },
    ]);

    const result = await getSchoolAggregateStats("school1");

    expect(result.stats.totalQuestionsAnswered).toBe(2);
  });

  it("computes today's question count and today's active-student count from startOfToday, not just the last 24h", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    mocked.finalizedAttempt.findMany.mockResolvedValue([
      { studentId: "s1", finalizedAt: new Date(startOfToday.getTime() + 1000) },
    ]);
    mocked.practiceSet.findMany.mockResolvedValue([
      { studentId: "s1", createdAt: startOfToday, completedAt: new Date(startOfToday.getTime() + 1000) },
    ]);

    const result = await getSchoolAggregateStats("school1");

    expect(result.questionsAnsweredToday).toBe(1);
    expect(result.studentsActiveToday).toBe(1);
  });
});
