import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSchoolCommunityData } from "@/lib/community/school-community-data";
import { installActivityQueryMock, type ActivityFixture } from "@/lib/school/test-fixtures";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    organization: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
    studentMembership: { findMany: vi.fn() },
    practiceSet: { count: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  organization: Record<string, ReturnType<typeof vi.fn>>;
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  $queryRaw: ReturnType<typeof vi.fn>;
};

// Every school-wide figure is now counted in the database (see
// lib/school/student-activity), so a test describes its fixture as rows and
// lib/school/test-fixtures derives what each query would have returned.
let fixture: ActivityFixture;

function givenAnswers(rows: { studentId: string; answeredAt: Date }[]) {
  fixture.answers = rows;
}

function givenSessions(rows: { studentId: string; startedAt: Date; completedAt: Date }[]) {
  fixture.sessions = rows;
}

function givenPredictions(rows: { studentId: string; representativeMidpoint: number; createdAt: Date }[]) {
  fixture.predictions = rows;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.organization.findUniqueOrThrow.mockResolvedValue({
    officialName: "Lebanon Trail High School",
    communityGoalMetric: null,
    communityGoalTarget: null,
  });
  mocked.practiceSet.count.mockResolvedValue(0);
  fixture = installActivityQueryMock(mocked.$queryRaw, { answers: [], sessions: [], predictions: [] });
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
    givenAnswers([
      { studentId: "s1", answeredAt: new Date() },
      { studentId: "s2", answeredAt: new Date() },
    ]);

    const result = await getSchoolCommunityData("school1");

    expect(JSON.stringify(result)).not.toContain("s1");
    expect(JSON.stringify(result)).not.toContain("s2");
    expect(result.stats.totalQuestionsAnswered).toBe(2);
  });

  it("counts an answer from any study mode, not just adaptive practice and the diagnostic", async () => {
    // The point of the shared answer query: the Daily Challenge, 1v1 Rush,
    // the 800 Club and Focused Practice all keep their own rows, and a campus
    // that uses them was previously reported as having answered nothing.
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    givenAnswers(Array.from({ length: 7 }, () => ({ studentId: "s1", answeredAt: new Date() })));

    const result = await getSchoolCommunityData("school1");

    expect(result.stats.totalQuestionsAnswered).toBe(7);
  });

  it("sums total study hours across every completed session for every active student", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    mocked.practiceSet.count.mockResolvedValue(1);
    givenSessions([
      {
        studentId: "s1",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        completedAt: new Date("2026-01-01T01:00:00Z"),
      },
      {
        studentId: "s1",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        completedAt: new Date("2026-01-01T00:30:00Z"),
      },
    ]);

    const result = await getSchoolCommunityData("school1");

    expect(result.stats.totalStudyHours).toBe(2); // 1h + 0.5h rounds to 2 (Math.round(1.5))
    expect(result.stats.totalAdaptiveSessionsCompleted).toBe(1);
  });

  it("counts a student active this week only once even with multiple recent attempts", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    const now = new Date();
    givenAnswers([
      { studentId: "s1", answeredAt: now },
      { studentId: "s1", answeredAt: now },
    ]);

    const result = await getSchoolCommunityData("school1");

    expect(result.stats.activeStudentsThisWeek).toBe(1);
  });

  it("does not count a student active more than 7 days ago", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    const longAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    givenAnswers([{ studentId: "s1", answeredAt: longAgo }]);

    const result = await getSchoolCommunityData("school1");

    expect(result.stats.activeStudentsThisWeek).toBe(0);
  });

  it("sums only positive per-student improvement — a regressed student contributes 0, not a negative offset", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }, { studentId: "s2" }]);
    givenPredictions([
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
    givenAnswers(Array.from({ length: 50 }, () => ({ studentId: "s1", answeredAt: new Date() })));

    const result = await getSchoolCommunityData("school1");

    expect(result.goal).toMatchObject({
      metric: "QUESTIONS_ANSWERED",
      label: "Questions Answered",
      current: 50,
      target: 100_000,
      prize: null,
      status: { state: "IN_PROGRESS", percent: 0, remaining: 99_950, daysLeft: null },
    });
  });

  // A goal with a window counts only what happened inside it: "5,000
  // questions" set today means 5,000 from today, not work done before anyone
  // knew there was a prize.
  it("counts a windowed goal from its start, not all-time", async () => {
    const startsAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    mocked.organization.findUniqueOrThrow.mockResolvedValue({
      officialName: "Lebanon Trail High School",
      communityGoalMetric: "QUESTIONS_ANSWERED",
      communityGoalTarget: 100,
      communityGoalPrize: "Pizza party",
      communityGoalStartsAt: startsAt,
      communityGoalEndsAt: null,
      communityGoalReachedAt: null,
    });
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    givenAnswers([
      { studentId: "s1", answeredAt: new Date(startsAt.getTime() - 60_000) }, // before the goal: not counted
      { studentId: "s1", answeredAt: new Date() },
      { studentId: "s1", answeredAt: new Date() },
    ]);

    const result = await getSchoolCommunityData("school1");

    expect(result.stats.totalQuestionsAnswered).toBe(3);
    expect(result.goal).toMatchObject({ current: 2, prize: "Pizza party", status: { state: "IN_PROGRESS" } });
  });

  it("stops counting at the deadline, and says the goal ended short", async () => {
    const startsAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mocked.organization.findUniqueOrThrow.mockResolvedValue({
      officialName: "Lebanon Trail High School",
      communityGoalMetric: "QUESTIONS_ANSWERED",
      communityGoalTarget: 100,
      communityGoalPrize: null,
      communityGoalStartsAt: startsAt,
      communityGoalEndsAt: endsAt,
      communityGoalReachedAt: null,
    });
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    givenAnswers([
      { studentId: "s1", answeredAt: new Date(endsAt.getTime() - 60_000) },
      { studentId: "s1", answeredAt: new Date() }, // after the deadline: not counted
    ]);

    const result = await getSchoolCommunityData("school1");

    expect(result.goal).toMatchObject({ current: 1, status: { state: "ENDED", remaining: 99 } });
    expect(mocked.organization.updateMany).not.toHaveBeenCalled();
  });

  it("records the moment a goal is first seen reached, guarded on the goal still being this one", async () => {
    mocked.organization.findUniqueOrThrow.mockResolvedValue({
      officialName: "Lebanon Trail High School",
      communityGoalMetric: "QUESTIONS_ANSWERED",
      communityGoalTarget: 2,
      communityGoalPrize: "Pizza party",
      communityGoalStartsAt: new Date(Date.now() - 60 * 60 * 1000),
      communityGoalEndsAt: null,
      communityGoalReachedAt: null,
    });
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    givenAnswers([
      { studentId: "s1", answeredAt: new Date() },
      { studentId: "s1", answeredAt: new Date() },
    ]);

    const result = await getSchoolCommunityData("school1");

    expect(result.goal?.status.state).toBe("REACHED");
    expect(result.goal?.reachedAt).toBeInstanceOf(Date);
    expect(mocked.organization.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "school1",
          communityGoalReachedAt: null,
          communityGoalMetric: "QUESTIONS_ANSWERED",
          communityGoalTarget: 2,
        }),
      }),
    );
  });

  it("keeps a won goal won after its deadline", async () => {
    const reachedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    mocked.organization.findUniqueOrThrow.mockResolvedValue({
      officialName: "Lebanon Trail High School",
      communityGoalMetric: "QUESTIONS_ANSWERED",
      communityGoalTarget: 100,
      communityGoalPrize: "Pizza party",
      communityGoalStartsAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      communityGoalEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      communityGoalReachedAt: reachedAt,
    });
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);

    const result = await getSchoolCommunityData("school1");

    expect(result.goal).toMatchObject({ reachedAt, status: { state: "REACHED" } });
    expect(mocked.organization.updateMany).not.toHaveBeenCalled();
  });

  it("returns no goal when the organization has not configured one", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);

    const result = await getSchoolCommunityData("school1");

    expect(result.goal).toBeNull();
  });
});
