import type { QuestionCategory } from "@/generated/prisma/client";
import { diagnosticValueFor } from "./diagnostic-value";
import { progressWithinRange, rangeForScore, type ScoreRange } from "./config";
import { mathValue, overallValue, readingWritingValue } from "./weighting";

export type DiagnosticCategoryResult = { easyCorrect: boolean; mediumCorrect: boolean; hardCorrect: boolean };

export type DiagnosticPredictionResult = {
  readingWritingValue: number;
  mathValue: number;
  diagnosticEstimate: number;
  range: ScoreRange;
  withinRangeProgress: number;
};

// PRD-016 §13.1 — pure computation half of the diagnostic prediction. Takes
// one Easy/Medium/Hard result per category and produces the internal
// diagnostic estimate, its displayed range, and within-range progress.
// Persistence (and the "exactly one E/M/H per category" completeness check)
// is the caller's job in generate-diagnostic-prediction.ts.
export function computeDiagnosticPrediction(results: Record<QuestionCategory, DiagnosticCategoryResult>): DiagnosticPredictionResult {
  const value = (category: QuestionCategory) => {
    const r = results[category];
    return diagnosticValueFor(r.easyCorrect, r.mediumCorrect, r.hardCorrect);
  };

  const rw = readingWritingValue(value("READING_COMPREHENSION"), value("GRAMMAR"), value("VOCABULARY"));
  const math = mathValue(value("ALGEBRA"), value("ADVANCED_MATH"), value("PROBLEM_SOLVING_DATA_ANALYSIS"), value("GEOMETRY_TRIGONOMETRY"));
  const diagnosticEstimate = overallValue(rw, math);
  const range = rangeForScore(diagnosticEstimate);
  const withinRangeProgress = progressWithinRange(diagnosticEstimate, range.scoreMin, range.scoreMax);

  return { readingWritingValue: rw, mathValue: math, diagnosticEstimate, range, withinRangeProgress };
}
