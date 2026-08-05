import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSchoolCommunityData } from "@/lib/community/school-community-data";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    organization: { findUniqueOrThrow: vi.fn() },
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
  organization: Record<string, ReturnType<typeof vi.fn>>;
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  finalizedAttempt: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticAttempt: Record<string, ReturnType<typeof vi.fn>>;
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
  predictionHistoryEntry: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.organization.findUniqueOrThrow.mockResolvedValue({
    officialName: "Lebanon Trail High School",
    communityGoalMetric: null,
    communityGoalTarget: null,
  });
  mocked.finalizedAttempt.findMany.mockResolvedValue([]);
  mocked.diagnosticAttempt.findMany.mockResolvedValue([]);
  mocked.practiceSet.findMany.mockResolvedValue([]);
  mocked.diagnosticSession.findMany.mockResolvedValue([]);
  mocked.predictionHistoryEntry.findMany.mockResolvedValue([]);
});

describe("getSchoolCommunityData", () => {
  it("returns all-zero stats and no goal/updates/milestones when the school has no active students", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([]);

    const result = await getSchoolCommunityData("school1");

    expect(result.schoolName).toBe("Lebanon Trail High School");
    expect(result.stats).toEqual({
      totalQuestionsAnswered: 0,
      totalStudyHours: 0,
      totalAdaptiveSessionsCompleted: 0,
      totalEstimatedSatPointsImproved: 0,
      activeStudentsThisWeek: 0,
      studyStreak: 0,
    });
    expect(result.goal).toBeNull();
    expect(result.updates).toEqual([]);
    expect(result.milestones).toEqual([]);
  });

  it("never exposes a per-student breakdown — only aggregate counts", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }, { studentId: "s2" }]);
    mocked.finalizedAttempt.findMany.mockResolvedValue([
      { studentId: "s1", finalizedAt: new Date() },
      { studentId: "s2", finalizedAt: new Date() },
    ]);

    const result = await getSchoolCommunityData("school1");

    expect(JSON.stringify(result)).not.toContain("s1");
    expect(JSON.stringify(result)).not.toContain("s2");
    expect(result.stats.totalQuestionsAnswered).toBe(2);
  });

  it("sums total study hours across completed practice sets and diagnostics for every active student", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    mocked.practiceSet.findMany.mockResolvedValue([
      { studentId: "s1", createdAt: new Date("2026-01-01T00:00:00Z"), completedAt: new Date("2026-01-01T01:00:00Z") },
    ]);
    mocked.diagnosticSession.findMany.mockResolvedValue([
      { studentId: "s1", startedAt: new Date("2026-01-01T00:00:00Z"), completedAt: new Date("2026-01-01T00:30:00Z") },
    ]);

    const result = await getSchoolCommunityData("school1");

    expect(result.stats.totalStudyHours).toBe(2); // 1h + 0.5h rounds to 2 (Math.round(1.5))
    expect(result.stats.totalAdaptiveSessionsCompleted).toBe(1);
  });

  it("counts a student active this week only once even with multiple recent attempts", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    const now = new Date();
    mocked.finalizedAttempt.findMany.mockResolvedValue([
      { studentId: "s1", finalizedAt: now },
      { studentId: "s1", finalizedAt: now },
    ]);

    const result = await getSchoolCommunityData("school1");

    expect(result.stats.activeStudentsThisWeek).toBe(1);
  });

  it("does not count a student active more than 7 days ago", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    const longAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    mocked.finalizedAttempt.findMany.mockResolvedValue([{ studentId: "s1", finalizedAt: longAgo }]);

    const result = await getSchoolCommunityData("school1");

    expect(result.stats.activeStudentsThisWeek).toBe(0);
  });

  it("sums only positive per-student improvement — a regressed student contributes 0, not a negative offset", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }, { studentId: "s2" }]);
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      { studentId: "s1", representativeMidpoint: 1000, createdAt: new Date("2026-01-01") },
      { studentId: "s1", representativeMidpoint: 1200, createdAt: new Date("2026-02-01") }, // +200
      { studentId: "s2", representativeMidpoint: 1200, createdAt: new Date("2026-01-01") },
      { studentId: "s2", representativeMidpoint: 1000, createdAt: new Date("2026-02-01") }, // -200 -> floored to 0
    ]);

    const result = await getSchoolCommunityData("school1");

    expect(result.stats.totalEstimatedSatPointsImproved).toBe(200);
  });

  it("computes the community goal's current progress from the matching stat", async () => {
    mocked.organization.findUniqueOrThrow.mockResolvedValue({
      officialName: "Lebanon Trail High School",
      communityGoalMetric: "QUESTIONS_ANSWERED",
      communityGoalTarget: 100_000,
    });
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    mocked.finalizedAttempt.findMany.mockResolvedValue(
      Array.from({ length: 50 }, () => ({ studentId: "s1", finalizedAt: new Date() })),
    );

    const result = await getSchoolCommunityData("school1");

    expect(result.goal).toEqual({ metric: "QUESTIONS_ANSWERED", label: "Questions Answered", current: 50, target: 100_000 });
  });

  it("returns no goal when the organization has not configured one", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);

    const result = await getSchoolCommunityData("school1");

    expect(result.goal).toBeNull();
  });
});
