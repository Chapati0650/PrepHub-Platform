import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProgressData } from "@/lib/progress/progress-data";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { prisma } from "@/lib/prisma";
import { getStudentActivity } from "@/lib/school/student-activity";
import { generateDiagnosticPrediction } from "@/lib/score/generate-diagnostic-prediction";

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

vi.mock("@/lib/score/generate-diagnostic-prediction", () => ({ generateDiagnosticPrediction: vi.fn() }));

const mocked = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockedActivity = getStudentActivity as unknown as ReturnType<typeof vi.fn>;
const mockedGenerate = generateDiagnosticPrediction as unknown as ReturnType<typeof vi.fn>;

function prediction(
  sourceType: "DIAGNOSTIC" | "ADAPTIVE_SET",
  min: number,
  sourceSetId: string | null = null,
  written: { approximateImprovement?: number; version?: string; max?: number; midpoint?: number } = {},
) {
  return {
    sourceType,
    sourceSetId,
    createdAt: new Date("2026-08-01"),
    displayedRangeMinimum: min,
    displayedRangeMaximum: written.max ?? min + 60,
    representativeMidpoint: written.midpoint ?? min + 30,
    approximateImprovement: written.approximateImprovement ?? 0,
    scoringEngineVersion: written.version ?? "2026.2",
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

  // Completion commits before the prediction; if that step failed, the page
  // used to throw on every visit reading the last element of an empty list.
  it("generates the Diagnostic prediction when a finished Diagnostic has none yet", async () => {
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([]);
    mocked.practiceSet.findMany.mockResolvedValue([]);
    mockedGenerate.mockResolvedValue(prediction("DIAGNOSTIC", 900));

    const data = await getProgressData("s1");
    if (data.diagnosticStatus !== "COMPLETED") throw new Error("expected a completed Diagnostic");

    expect(mockedGenerate).toHaveBeenCalledWith("s1");
    expect(data.currentRange).toEqual({ min: 900, max: 960, point: null });
    expect(data.history.map((h) => h.label)).toEqual(["Diagnostic"]);
  });

  // It measured from the starting range's bottom to the current range's top,
  // so the bar showed the range's own width as progress before any practice.
  it("starts the target bar empty and measures midpoint to midpoint", async () => {
    mocked.user.findUniqueOrThrow.mockResolvedValue({ targetScore: 1330 });
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([prediction("DIAGNOSTIC", 1000)]);
    let data = await getProgressData("s1");
    if (data.diagnosticStatus !== "COMPLETED") throw new Error("expected a completed Diagnostic");
    expect(data.targetProgressFraction).toBe(0);

    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      prediction("DIAGNOSTIC", 1000),
      prediction("ADAPTIVE_SET", 1150, "set1", { approximateImprovement: 150 }),
    ]);
    data = await getProgressData("s1");
    if (data.diagnosticStatus !== "COMPLETED") throw new Error("expected a completed Diagnostic");
    // Midpoints 1030 -> 1180 against a target of 1330: halfway.
    expect(data.targetProgressFraction).toBe(0.5);
  });

  it("measures from the Diagnostic as the latest engine scores it, and marks older predictions", async () => {
    // Started before the recalibration: an inflated 2026.1 Diagnostic, then a
    // recalibrated set 80 points above the Diagnostic as 2026.2 scores it.
    mocked.user.findUniqueOrThrow.mockResolvedValue({ targetScore: 1405 });
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      prediction("DIAGNOSTIC", 1130, null, { max: 1200, midpoint: 1165, version: "2026.1" }),
      prediction("ADAPTIVE_SET", 1050, "set1", { max: 1120, midpoint: 1085, approximateImprovement: 80 }),
    ]);
    const data = await getProgressData("s1");
    if (data.diagnosticStatus !== "COMPLETED") throw new Error("expected a completed Diagnostic");

    expect(data.history.map((p) => p.earlierMethod)).toEqual([true, false]);
    // Start 1005 (970-1040), now 1085, target 1405: a fifth of the way.
    expect(data.targetProgressFraction).toBeCloseTo(80 / 400, 9);
    expect(data.journeyNarrative).not.toContain("1130");
  });

  it("shows a 2026.3 prediction as a score with its band, measured from the score the student started at", async () => {
    mocked.user.findUniqueOrThrow.mockResolvedValue({ targetScore: 1300 });
    mocked.predictionHistoryEntry.findMany.mockResolvedValue([
      prediction("DIAGNOSTIC", 880, null, { max: 1040, midpoint: 960, version: "2026.2" }),
      prediction("DIAGNOSTIC", 900, null, { max: 1020, midpoint: 960, version: "2026.3" }),
      prediction("ADAPTIVE_SET", 1090, "set1", { max: 1190, midpoint: 1140, approximateImprovement: 180, version: "2026.3" }),
    ]);
    const data = await getProgressData("s1");
    if (data.diagnosticStatus !== "COMPLETED") throw new Error("expected a completed Diagnostic");

    expect(data.currentRange).toEqual({ min: 1090, max: 1190, point: 1140 });
    expect(data.history.map((p) => p.point)).toEqual([null, 960, 1140]);
    expect(data.history.map((p) => p.earlierMethod)).toEqual([true, false, false]);
    // Measured to the score (1140), not the top of the band (1190).
    expect(data.remainingToTarget).toBe(160);
    // Started at 960 (1140 - 180): 180 of the 340 needed.
    expect(data.targetProgressFraction).toBeCloseTo(180 / 340, 9);
    expect(data.journeyNarrative).toContain("predicted SAT score of about 960.");
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
