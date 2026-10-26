import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDiagnosticResultsData, getPracticeSetResultsData } from "@/lib/session/session-results-data";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { prisma } from "@/lib/prisma";
import { generateDiagnosticPrediction } from "@/lib/score/generate-diagnostic-prediction";
import { generateAdaptivePrediction } from "@/lib/score/generate-adaptive-prediction";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    diagnosticSession: { findUniqueOrThrow: vi.fn() },
    practiceSet: { findUniqueOrThrow: vi.fn() },
    predictionHistoryEntry: { findFirst: vi.fn() },
    categoryState: { findMany: vi.fn() },
    user: { findUniqueOrThrow: vi.fn() },
  };
  return { prisma: mockPrisma };
});

// Generation's own idempotency and locking are tested in lib/score; here it
// only matters that the results read through it rather than around it.
vi.mock("@/lib/score/generate-diagnostic-prediction", () => ({ generateDiagnosticPrediction: vi.fn() }));
vi.mock("@/lib/score/generate-adaptive-prediction", () => ({ generateAdaptivePrediction: vi.fn() }));

const mocked = prisma as unknown as {
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  predictionHistoryEntry: Record<string, ReturnType<typeof vi.fn>>;
  categoryState: Record<string, ReturnType<typeof vi.fn>>;
  user: Record<string, ReturnType<typeof vi.fn>>;
};
const diagnosticPrediction = vi.mocked(generateDiagnosticPrediction);
const adaptivePrediction = vi.mocked(generateAdaptivePrediction);

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
        { id: `a${i}e`, position: i * 3, category, isCorrect: true, waivedAt: null },
        { id: `a${i}m`, position: i * 3 + 1, category, isCorrect: false, waivedAt: null },
        { id: `a${i}h`, position: i * 3 + 2, category, isCorrect: true, waivedAt: null },
      ]),
    });
    diagnosticPrediction.mockResolvedValue({ displayedRangeMinimum: 890, displayedRangeMaximum: 960 } as never);
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
    expect(diagnosticPrediction).toHaveBeenCalledWith("student1");
  });

  it("leaves out the bonus questions a student never earned, so they aren't shown as wrong answers", async () => {
    // Staged Diagnostic: 14 core questions, then two of the seven Hard ones
    // earned (one answered right, one wrong) and five waived, never served.
    const started = new Date("2026-01-01T00:00:00Z");
    const completed = new Date("2026-01-01T00:16:00Z"); // 16 minutes over 16 questions shown
    const core = ALL_CATEGORIES.flatMap((category, i) => [
      { id: `e${i}`, position: i * 2, category, isCorrect: true, waivedAt: null },
      { id: `m${i}`, position: i * 2 + 1, category, isCorrect: i < 2, waivedAt: null },
    ]);
    const bonus = ALL_CATEGORIES.map((category, i) => ({
      id: `h${i}`,
      position: 14 + i,
      category,
      isCorrect: i === 0 ? true : i === 1 ? false : null,
      waivedAt: i < 2 ? null : new Date(),
    }));
    mocked.diagnosticSession.findUniqueOrThrow.mockResolvedValue({ startedAt: started, completedAt: completed, attempts: [...core, ...bonus] });
    diagnosticPrediction.mockResolvedValue({ displayedRangeMinimum: 890, displayedRangeMaximum: 960 } as never);
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(50));

    const result = await getDiagnosticResultsData("student1");

    expect(result.stats.total).toBe(16);
    expect(result.stats.correct).toBe(7 + 2 + 1);
    expect(result.stats.accuracy).toBe(Math.round((10 / 16) * 100));
    expect(result.stats.avgTimeSeconds).toBe(60);
    expect(result.questions.map((q) => q.id)).toEqual([...core.map((a) => a.id), "h0", "h1"]);
    // Numbered as the student saw them: 1-14, then 15 and 16, no gaps.
    expect(result.questions.map((q) => q.position)).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it("generates the prediction when completion committed but the prediction step didn't", async () => {
    // The page used to read it with findFirstOrThrow, which fails every visit
    // forever once the prediction is missing. It goes through the idempotent
    // generator instead; the generator returns the existing entry when there is one.
    mocked.diagnosticSession.findUniqueOrThrow.mockResolvedValue({ startedAt: new Date(), completedAt: new Date(), attempts: [] });
    diagnosticPrediction.mockResolvedValue({ displayedRangeMinimum: 1000, displayedRangeMaximum: 1070 } as never);
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(50));

    const result = await getDiagnosticResultsData("student1");

    expect(diagnosticPrediction).toHaveBeenCalledTimes(1);
    expect(result.currentRange).toEqual({ min: 1000, max: 1070 });
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
    adaptivePrediction.mockResolvedValue({
      displayedRangeMinimum: 730,
      displayedRangeMaximum: 800,
      approximateImprovement: 200,
      createdAt: new Date("2026-01-01T00:21:00Z"),
    } as never);
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
    adaptivePrediction.mockResolvedValue({
      displayedRangeMinimum: 810,
      displayedRangeMaximum: 880,
      approximateImprovement: 40,
      createdAt: new Date("2026-01-01T00:21:00Z"),
    } as never);
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
    adaptivePrediction.mockResolvedValue({
      displayedRangeMinimum: 400,
      displayedRangeMaximum: 480,
      approximateImprovement: 0,
      createdAt: new Date(),
    } as never);
    mocked.categoryState.findMany.mockResolvedValue([]);

    await expect(getPracticeSetResultsData("student1", "set1")).rejects.toThrow(/not found/i);
    // Checked before generating anything, so another student's set never gets a prediction written for it.
    expect(adaptivePrediction).not.toHaveBeenCalled();
  });
});
