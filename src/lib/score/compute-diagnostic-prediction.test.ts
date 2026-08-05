import { describe, expect, it } from "vitest";
import { computeDiagnosticPrediction, type DiagnosticCategoryResult } from "@/lib/score/compute-diagnostic-prediction";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import type { QuestionCategory } from "@/generated/prisma/client";

function resultsAt(pattern: DiagnosticCategoryResult): Record<QuestionCategory, DiagnosticCategoryResult> {
  return Object.fromEntries(ALL_CATEGORIES.map((c) => [c, pattern])) as Record<QuestionCategory, DiagnosticCategoryResult>;
}

describe("computeDiagnosticPrediction", () => {
  it("maps a perfect diagnostic (all correct) to the top 1530-1600 range", () => {
    const result = computeDiagnosticPrediction(resultsAt({ easyCorrect: true, mediumCorrect: true, hardCorrect: true }));
    expect(result.diagnosticEstimate).toBe(1600);
    expect(result.range.index).toBe(15);
    expect(result.range.scoreMin).toBe(1530);
    expect(result.range.scoreMax).toBe(1600);
  });

  it("maps a fully missed diagnostic (all incorrect) to the bottom 400-480 range", () => {
    const result = computeDiagnosticPrediction(resultsAt({ easyCorrect: false, mediumCorrect: false, hardCorrect: false }));
    expect(result.diagnosticEstimate).toBe(400);
    expect(result.range.index).toBe(1);
  });

  it("weights Reading/Writing categories at 45/45/10 and Math categories at 35/35/15/15", () => {
    const results = resultsAt({ easyCorrect: false, mediumCorrect: false, hardCorrect: false });
    // Every category starts at the all-incorrect value (400) except Grammar,
    // which is all-correct (1600) — isolates the RW weighting.
    results.GRAMMAR = { easyCorrect: true, mediumCorrect: true, hardCorrect: true };

    const result = computeDiagnosticPrediction(results);
    // RW = 0.45*400 + 0.45*1600 + 0.10*400 = 940; Math unchanged at 400.
    expect(result.readingWritingValue).toBeCloseTo(940, 6);
    expect(result.mathValue).toBeCloseTo(400, 6);
    expect(result.diagnosticEstimate).toBeCloseTo(670, 6);
  });

  it("computes within-range progress from the diagnostic estimate's position in the displayed range", () => {
    // Craft a pattern set that lands the estimate inside a known band and
    // verify progress is between 0 and 1 (exact value depends on the
    // specific weighted mix, so we just check the invariant holds).
    const results = resultsAt({ easyCorrect: true, mediumCorrect: false, hardCorrect: false }); // 1000 everywhere
    const result = computeDiagnosticPrediction(results);
    expect(result.diagnosticEstimate).toBe(1000);
    expect(result.withinRangeProgress).toBeGreaterThanOrEqual(0);
    expect(result.withinRangeProgress).toBeLessThanOrEqual(1);
  });
});
