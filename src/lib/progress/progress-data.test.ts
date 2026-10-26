import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProgressData } from "@/lib/progress/progress-data";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { prisma } from "@/lib/prisma";
import { getStudentActivity } from "@/lib/school/student-activity";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    user: { findUniqueOrThrow: vi.fn() },
    diagnosticSession: { findUnique: vi.fn() },
    predictionHistoryEntry: { findMany: vi.fn() },
    categoryState: { findMany: vi.fn() },
    practiceSet: { findMany: vi.fn() },
  };
  return { prisma: mockPrisma };
});

vi.mock("@/lib/school/student-activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/school/student-activity")>()),
  getStudentActivity: vi.fn(),
}));

const mocked = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockedActivity = getStudentActivity as unknown as ReturnType<typeof vi.fn>;

function prediction(sourceType: "DIAGNOSTIC" | "ADAPTIVE_SET", min: number, sourceSetId: string | null = null) {
  return {
    sourceType,
    sourceSetId,
    createdAt: new Date("2026-08-01"),
    displayedRangeMinimum: min,
    displayedRangeMaximum: min + 60,
    representativeMidpoint: min + 30,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.user.findUniqueOrThrow.mockResolvedValue({ targetScore: null });
  mocked.diagnosticSession.findUnique.mockResolvedValue({ status: "COMPLETED" });
  mocked.categoryState.findMany.mockResolvedValue(ALL_CATEGORIES.map((category) => ({ category, ability: 50, initialAbility: 50 })));
  mocked.predictionHistoryEntry.findMany.mockResolvedValue([
    prediction("DIAGNOSTIC", 1000),
    prediction("ADAPTIVE_SET", 1040, "set1"),
  ]);
  mocked.practiceSet.findMany.mockResolvedValue([{ id: "set1", setNumber: 1 }]);
  mockedActivity.mockResolvedValue(new Map());
});

describe("getProgressData", () => {
  it("reports nothing to show before the Diagnostic is finished", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({ status: "IN_PROGRESS" });

    expect(await getProgressData("s1")).toEqual({ diagnosticStatus: "IN_PROGRESS" });
    expect(mockedActivity).not.toHaveBeenCalled();
  });

  // These counted the Diagnostic and Practice Sets only, so homework, rushes
  // and the Daily Challenge never showed, and "Questions Answered" disagreed
  // with the dashboard's figure of the same name.
  it("takes Study Statistics from every study mode", async () => {
    mockedActivity.mockResolvedValue(
      new Map([["s1", { questionsAnswered: 120, sessionsCompleted: 6, studyHours: 2.5, lastActiveAt: null }]]),
    );

    const data = await getProgressData("s1");
    if (data.diagnosticStatus !== "COMPLETED") throw new Error("expected a completed Diagnostic");

    expect(mockedActivity).toHaveBeenCalledWith(["s1"]);
    expect(data.studyStats).toEqual({
      totalStudyTimeSeconds: 9000,
      averageSessionLengthSeconds: 1500,
      totalQuestionsAnswered: 120,
      completedSessions: 6,
    });
  });

  it("keeps the journey narrative to Practice Sets, the only sessions that move the prediction", async () => {
    mockedActivity.mockResolvedValue(
      new Map([["s1", { questionsAnswered: 120, sessionsCompleted: 6, studyHours: 2.5, lastActiveAt: null }]]),
    );

    const data = await getProgressData("s1");
    if (data.diagnosticStatus !== "COMPLETED") throw new Error("expected a completed Diagnostic");

    expect(data.journeyNarrative).toContain("completed 1 practice set, answered 120 questions");
    expect(data.history.map((h) => h.label)).toEqual(["Diagnostic", "Set 1"]);
  });

  it("reports zeros rather than dividing by nothing when there's no activity", async () => {
    const data = await getProgressData("s1");
    if (data.diagnosticStatus !== "COMPLETED") throw new Error("expected a completed Diagnostic");

    expect(data.studyStats).toEqual({
      totalStudyTimeSeconds: 0,
      averageSessionLengthSeconds: 0,
      totalQuestionsAnswered: 0,
      completedSessions: 0,
    });
  });
});
