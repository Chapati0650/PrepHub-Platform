import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSchoolAggregateStats } from "@/lib/school/aggregate-stats";
import { installActivityQueryMock, type ActivityFixture } from "@/lib/school/test-fixtures";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    studentMembership: { findMany: vi.fn() },
    practiceSet: { count: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  $queryRaw: ReturnType<typeof vi.fn>;
};

let fixture: ActivityFixture;

beforeEach(() => {
  vi.clearAllMocks();
  mocked.practiceSet.count.mockResolvedValue(0);
  fixture = installActivityQueryMock(mocked.$queryRaw, { answers: [], sessions: [], predictions: [] });
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

  it("asks the database for nothing at all when the school has no ACTIVE students", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([]);

    await getSchoolAggregateStats("school1");

    // An `IN ()` over an empty id list is both invalid and pointless; every
    // activity query short-circuits instead.
    expect(mocked.$queryRaw).not.toHaveBeenCalled();
  });

  it("scopes every query to only ACTIVE StudentMembership rows for the school", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);

    await getSchoolAggregateStats("school1");

    expect(mocked.studentMembership.findMany).toHaveBeenCalledWith({
      where: { schoolId: "school1", status: "ACTIVE" },
      select: { studentId: true },
    });
  });

  it("aggregates questions answered across every study mode, not only adaptive practice", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    fixture.answers = [
      { studentId: "s1", answeredAt: new Date() },
      { studentId: "s1", answeredAt: new Date() },
    ];

    const result = await getSchoolAggregateStats("school1");

    expect(result.stats.totalQuestionsAnswered).toBe(2);
  });

  it("counts Adaptive Sessions from PracticeSet alone — a Rush run is not one", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    mocked.practiceSet.count.mockResolvedValue(3);
    // Five completed sessions of some kind, only three of them adaptive.
    fixture.sessions = Array.from({ length: 5 }, () => ({
      studentId: "s1",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: new Date("2026-01-01T00:20:00Z"),
    }));

    const result = await getSchoolAggregateStats("school1");

    expect(result.stats.totalAdaptiveSessionsCompleted).toBe(3);
  });

  it("computes today's question count and today's active-student count from startOfToday, not just the last 24h", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    fixture.answers = [{ studentId: "s1", answeredAt: new Date(startOfToday.getTime() + 1000) }];

    const result = await getSchoolAggregateStats("school1");

    expect(result.questionsAnsweredToday).toBe(1);
    expect(result.studentsActiveToday).toBe(1);
  });

  it("treats any answer as activity for today, not only a completed session", async () => {
    // A student who only answered the Daily Challenge finished no session at
    // all, and was previously reported as inactive.
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    fixture.answers = [{ studentId: "s1", answeredAt: new Date() }];

    const result = await getSchoolAggregateStats("school1");

    expect(result.studentsActiveToday).toBe(1);
  });
});
