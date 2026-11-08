import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateDiagnosticPrediction } from "@/lib/score/generate-diagnostic-prediction";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { abilitiesFromHistory } from "@/lib/adaptive/diagnostic-initialization";
import { estimateAbilities } from "@/lib/adaptive/estimate";
import { computeDiagnosticPrediction } from "@/lib/score/compute-diagnostic-prediction";
import { SCORING_ENGINE_VERSION } from "@/lib/score/config";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    predictionHistoryEntry: { findFirst: vi.fn(), create: vi.fn() },
    diagnosticSession: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  (mockPrisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation((fn: (tx: unknown) => unknown) => fn(mockPrisma));
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  predictionHistoryEntry: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
  $queryRaw: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.predictionHistoryEntry.findFirst.mockResolvedValue(null);
  mocked.predictionHistoryEntry.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "pred1",
    ...data,
  }));
});

function fullDiagnosticAttempts(isCorrect: boolean) {
  const submittedAt = new Date("2026-11-06T12:00:00Z");
  return ALL_CATEGORIES.flatMap((category) =>
    (["EASY", "MEDIUM", "HARD"] as const).map((difficulty) => ({ category, difficulty, isCorrect, submittedAt, waivedAt: null })),
  );
}

/** What a perfect Diagnostic predicts: all twenty-one right, through the one estimate. */
function perfectPrediction() {
  const answers = fullDiagnosticAttempts(true).map(({ category, difficulty }) => ({ category, difficulty, isCorrect: true }));
  return computeDiagnosticPrediction(abilitiesFromHistory(answers), answers);
}

describe("generateDiagnosticPrediction", () => {
  it("is idempotent — returns the existing DIAGNOSTIC entry without recomputing", async () => {
    const existing = { id: "existing-pred" };
    mocked.predictionHistoryEntry.findFirst.mockResolvedValue(existing);

    const result = await generateDiagnosticPrediction("student1");

    expect(result).toBe(existing);
    expect(mocked.diagnosticSession.findUnique).not.toHaveBeenCalled();
  });

  it("returns the entry a concurrent call wrote while this one waited on the Diagnostic's lock", async () => {
    // Both calls missed the fast-path check (a retried completion racing the
    // results page); the re-check under the lock finds the winner's entry.
    const winner = { id: "pred-winner" };
    mocked.predictionHistoryEntry.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);

    const result = await generateDiagnosticPrediction("student1");

    expect(result).toBe(winner);
    expect(mocked.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocked.predictionHistoryEntry.create).not.toHaveBeenCalled();
  });

  it("throws DIAGNOSTIC_INCOMPLETE when no diagnostic session exists", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue(null);

    await expect(generateDiagnosticPrediction("student1")).rejects.toThrow(/diagnostic/i);
  });

  it("throws DIAGNOSTIC_INCOMPLETE when the session is still IN_PROGRESS", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({ status: "IN_PROGRESS", attempts: [] });

    await expect(generateDiagnosticPrediction("student1")).rejects.toThrow();
  });

  it("treats a missing difficulty as no answer at all instead of throwing (incomplete question coverage)", async () => {
    const attempts = fullDiagnosticAttempts(true).filter(
      (a) => !(a.category === ALL_CATEGORIES[0] && a.difficulty === "HARD"),
    );
    mocked.diagnosticSession.findUnique.mockResolvedValue({ status: "COMPLETED", attempts });

    const result = (await generateDiagnosticPrediction("student1")) as { internalDiagnosticEstimate: number };

    // No throw, and the slot the bank couldn't fill is no evidence either
    // way: everything served was right, so this is still a perfect Diagnostic.
    expect(result.internalDiagnosticEstimate).toBe(perfectPrediction().totalScore);
    // Never scored as the miss it would be if the question had been served.
    const withAMiss = fullDiagnosticAttempts(true).map((a) =>
      a.category === ALL_CATEGORIES[0] && a.difficulty === "HARD" ? { ...a, isCorrect: false } : a,
    );
    const missedAnswers = withAMiss.map(({ category, difficulty, isCorrect }) => ({ category, difficulty, isCorrect }));
    const missed = computeDiagnosticPrediction(abilitiesFromHistory(missedAnswers), missedAnswers);
    expect(result.internalDiagnosticEstimate).toBeGreaterThan(missed.totalScore);
    expect(missed.totalScore).toBeGreaterThan(computeDiagnosticPrediction(estimateAbilities([]), []).totalScore);
  });

  it("still produces a prediction when a category has no attempts at all", async () => {
    const attempts = fullDiagnosticAttempts(true).filter((a) => a.category !== ALL_CATEGORIES[0]);
    mocked.diagnosticSession.findUnique.mockResolvedValue({ status: "COMPLETED", attempts });

    const result = (await generateDiagnosticPrediction("student1")) as { internalDiagnosticEstimate: number; displayedRangeMinimum: number };

    // The category's ability comes from the rest of its section.
    expect(result.internalDiagnosticEstimate).toBeLessThanOrEqual(perfectPrediction().totalScore);
    expect(result.displayedRangeMinimum).toBeGreaterThanOrEqual(400);
  });

  it("generates a DIAGNOSTIC prediction with null sourceSetId and populated internalDiagnosticEstimate for a perfect diagnostic", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({ status: "COMPLETED", attempts: fullDiagnosticAttempts(true) });

    const result = (await generateDiagnosticPrediction("student1")) as {
      sourceType: string;
      sourceSetId: string | null;
      internalDiagnosticEstimate: number;
      displayedRangeMinimum: number;
      displayedRangeMaximum: number;
      representativeMidpoint: number;
      approximateImprovement: number;
      readingWritingAbility: number;
      mathAbility: number;
      scoringEngineVersion: string;
    };

    const expected = perfectPrediction();
    expect(result.sourceType).toBe("DIAGNOSTIC");
    expect(result.sourceSetId).toBeNull();
    expect(result.internalDiagnosticEstimate).toBe(expected.totalScore);
    // From 2026.3 the entry stores a score and its likely band.
    expect(result.representativeMidpoint).toBe(expected.point);
    expect(result.displayedRangeMinimum).toBe(expected.low);
    expect(result.displayedRangeMaximum).toBe(expected.high);
    expect(result.displayedRangeMinimum).toBeLessThan(result.representativeMidpoint);
    expect(result.approximateImprovement).toBe(0);
    expect(result.scoringEngineVersion).toBe(SCORING_ENGINE_VERSION);
    // A perfect Diagnostic predicts the top of the scale (the Diagnostic
    // ceiling, adaptive/diagnostic-initialization.ts).
    expect(result.representativeMidpoint).toBeGreaterThanOrEqual(1530);
    expect(result.displayedRangeMaximum).toBe(1600);
    // Section abilities, as on every Practice Set entry, not 400-1600 values.
    expect(result.readingWritingAbility).toBeLessThanOrEqual(100);
    expect(result.mathAbility).toBeLessThanOrEqual(100);
  });
});
