import type { QuestionCategory } from "@/generated/prisma/client";
import { progressWithinRange, rangeForAbility, type ScoreRange } from "./config";
import { mathValue, overallValue, readingWritingValue } from "./weighting";

export type AdaptivePredictionResult = {
  readingWritingAbility: number;
  mathAbility: number;
  overallAbility: number;
  range: ScoreRange;
  withinRangeProgress: number;
  approximateImprovement: number;
};

// PRD-016 §13.2 — pure computation half of a post-set prediction. Takes the
// student's seven current Ability Scores plus the diagnostic prediction's
// representative midpoint (the fixed improvement baseline, §7) and produces
// the new range, within-range progress, and approximate improvement.
export function computeAdaptivePrediction(
  abilities: Record<QuestionCategory, number>,
  initialDiagnosticMidpoint: number,
): AdaptivePredictionResult {
  const rw = readingWritingValue(
    abilities.READING_COMPREHENSION,
    abilities.GRAMMAR,
    abilities.VOCABULARY,
  );
  const math = mathValue(
    abilities.ALGEBRA,
    abilities.ADVANCED_MATH,
    abilities.PROBLEM_SOLVING_DATA_ANALYSIS,
    abilities.GEOMETRY_TRIGONOMETRY,
  );
  const overallAbility = overallValue(rw, math);
  const range = rangeForAbility(overallAbility);
  const withinRangeProgress = progressWithinRange(overallAbility, range.abilityMin, range.abilityMax);
  const approximateImprovement = range.midpoint - initialDiagnosticMidpoint;

  return { readingWritingAbility: rw, mathAbility: math, overallAbility, range, withinRangeProgress, approximateImprovement };
}
