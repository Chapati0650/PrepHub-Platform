import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { getDashboardData } from "@/lib/dashboard/dashboard-data";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { prisma } from "@/lib/prisma";
import { studyHoursBetween } from "@/lib/school/student-activity";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    user: { findUniqueOrThrow: vi.fn() },
    diagnosticSession: { findUnique: vi.fn() },
    predictionHistoryEntry: { findFirst: vi.fn(), findMany: vi.fn() },
    practiceSet: { findFirst: vi.fn() },
    categoryState: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return { prisma: mockPrisma };
});

// The answer fragment stays real, so the query this module sends can be read
// back; the study-hours query is its own tested module's business.
vi.mock("@/lib/school/student-activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/school/student-activity")>()),
  studyHoursBetween: vi.fn(),
}));

const mocked = prisma as unknown as {
  user: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
  predictionHistoryEntry: Record<string, ReturnType<typeof vi.fn>>;
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  categoryState: Record<string, ReturnType<typeof vi.fn>>;
  $queryRaw: ReturnType<typeof vi.fn>;
};
const mockedStudyHours = studyHoursBetween as unknown as ReturnType<typeof vi.fn>;

function categoryStatesAt(ability: number) {
  return ALL_CATEGORIES.map((category) => ({ category, ability }));
}

function answerTotals(totals: { total?: number; thisWeek?: number; studyDays?: string[] | null }) {
  mocked.$queryRaw.mockResolvedValue([{ total: 0, thisWeek: 0, studyDays: null, ...totals }]);
}

// The tagged-template call as one query, nested fragments included.
function sentQuery(): Prisma.Sql {
  const [strings, ...values] = mocked.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
  return Prisma.sql(strings, ...values);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.user.findUniqueOrThrow.mockResolvedValue({ firstName: "Prithviraj" });
  mocked.practiceSet.findFirst.mockResolvedValue(null);
  mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(50));
  mocked.predictionHistoryEntry.findMany.mockResolvedValue([]);
  answerTotals({});
  mockedStudyHours.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getDashboardData", () => {
  it("reports NOT_STARTED with no prediction when no diagnostic session exists", async () => {
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

  // Settings shows the streak and the question count whatever the Diagnostic's
  // status, and a student can do the Daily Challenge, Rush and homework first.
  it("reports real activity before the Diagnostic is finished", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-04T15:00:00Z"));
    mocked.diagnosticSession.findUnique.mockResolvedValue(null);
    answerTotals({ total: 9, thisWeek: 4, studyDays: ["2026-08-03", "2026-08-04"] });

    const result = await getDashboardData("student1");

    expect(result.totalQuestionsAnswered).toBe(9);
    expect(result.weeklyQuestionsCompleted).toBe(4);
    expect(result.studyStreak).toBe(2);
  });

  it("computes approximate improvement since the diagnostic baseline", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      status: "COMPLETED",
      startedAt: new Date("2026-01-01"),
      completedAt: new Date("2026-01-01"),
    });
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([{ displayedRangeMinimum: 810, displayedRangeMaximum: 880, representativeMidpoint: 845 }]); // latest
    mocked.predictionHistoryEntry.findFirst.mockResolvedValue({ representativeMidpoint: 605 }); // diagnostic baseline

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
    mocked.predictionHistoryEntry.findFirst.mockResolvedValue({ representativeMidpoint: 605 });
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      { displayedRangeMinimum: 810, displayedRangeMaximum: 880, representativeMidpoint: 845 },
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
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([{ displayedRangeMinimum: 810, displayedRangeMaximum: 880, representativeMidpoint: 845 }]);
    mocked.predictionHistoryEntry.findFirst.mockResolvedValue({ representativeMidpoint: 845 });
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(55)); // +5 from snapshot below
    mocked.practiceSet.findFirst.mockResolvedValue({
      categorySnapshots: [{ category: "ALGEBRA", abilityAtGeneration: 50 }],
    });

    const result = await getDashboardData("student1");

    expect(result.recentImprovements).toContain("Algebra mastery improved.");
  });

  it("does not extend the streak or count activity when no answers exist", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
    });
    mocked.predictionHistoryEntry.findFirst.mockResolvedValue(null);

    const result = await getDashboardData("student1");

    expect(result.studyStreak).toBe(0);
    expect(result.totalQuestionsAnswered).toBe(0);
    expect(result.weeklyQuestionsCompleted).toBe(0);
    expect(result.weeklyStudyTimeSeconds).toBe(0);
  });

  describe("activity from every study mode", () => {
    beforeEach(() => {
      mocked.diagnosticSession.findUnique.mockResolvedValue({ status: "COMPLETED", startedAt: new Date(), completedAt: new Date() });
      mocked.predictionHistoryEntry.findFirst.mockResolvedValue(null);
    });

    // These counted adaptive practice and the Diagnostic only, so a student
    // whose week was the Daily Challenge and their homework saw zeros.
    it("counts answers through the shared activity fragment, which covers all seven tables", async () => {
      answerTotals({ total: 57, thisWeek: 12 });

      const result = await getDashboardData("student1");

      expect(result.totalQuestionsAnswered).toBe(57);
      expect(result.weeklyQuestionsCompleted).toBe(12);
      expect(mocked.$queryRaw).toHaveBeenCalledTimes(1);
      const query = sentQuery();
      for (const table of [
        "finalized_attempts",
        "diagnostic_attempts",
        "focused_slots",
        "club_slots",
        "rush_answers",
        "daily_challenge_attempts",
        "homework_slots",
      ]) {
        expect(query.sql).toContain(table);
      }
      expect(query.values).toContain("student1");
    });

    it("keys study days in Central time and bounds the streak scan", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-08-04T15:00:00Z"));

      await getDashboardData("student1");

      const query = sentQuery();
      expect(query.sql).toContain("AT TIME ZONE");
      expect(query.values).toContain("America/Chicago");
      // The streak's horizon: two years back, not the whole history.
      expect(query.values).toContainEqual(new Date("2024-08-04T15:00:00Z"));
    });

    // 9pm Central on August 3rd is already August 4th in UTC. Counted in UTC,
    // "today" would be the 4th and the student's unbroken run through the
    // 2nd would read as broken at 7pm.
    it("doesn't end a Texas student's day at 7pm", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-08-04T02:00:00Z"));
      answerTotals({ total: 2, studyDays: ["2026-08-01", "2026-08-02"] });

      const result = await getDashboardData("student1");

      expect(result.studyStreak).toBe(2);
    });

    it("counts an answer at 9pm Central toward that day", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-08-04T02:00:00Z"));
      answerTotals({ total: 3, studyDays: ["2026-08-01", "2026-08-02", "2026-08-03"] });

      const result = await getDashboardData("student1");

      expect(result.studyStreak).toBe(3);
    });

    it("takes this week's study time from every finished session", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-08-04T15:00:00Z"));
      mockedStudyHours.mockResolvedValue(1.5);

      const result = await getDashboardData("student1");

      expect(result.weeklyStudyTimeSeconds).toBe(5400);
      expect(mockedStudyHours).toHaveBeenCalledWith(
        ["student1"],
        new Date("2026-07-28T15:00:00Z"),
        new Date("2026-08-04T15:00:00Z"),
      );
    });
  });
});
