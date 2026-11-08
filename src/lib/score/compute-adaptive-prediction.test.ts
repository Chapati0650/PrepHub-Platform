import { describe, expect, it } from "vitest";
import { computeAdaptivePrediction } from "@/lib/score/compute-adaptive-prediction";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import type { QuestionCategory } from "@/generated/prisma/client";

function abilitiesAt(value: number): Record<QuestionCategory, number> {
  return Object.fromEntries(ALL_CATEGORIES.map((c) => [c, value])) as Record<QuestionCategory, number>;
}

describe("computeAdaptivePrediction", () => {
  it("maps ability 100 everywhere to the top of the scale and 0 to the bottom", () => {
    const top = computeAdaptivePrediction(abilitiesAt(100), [], 400);
    expect(top.overallAbility).toBe(100);
    expect(top.point).toBe(1600);
    expect(top.high).toBe(1600);

    const bottom = computeAdaptivePrediction(abilitiesAt(0), [], 1600);
    expect(bottom.overallAbility).toBe(0);
    expect(bottom.point).toBe(400);
    expect(bottom.low).toBe(400);
  });

  it("averages the two section abilities into the overall ability, each weighted inside its section", () => {
    // RW = 0.45R + 0.45G + 0.10V, Math = 0.35A + 0.35AM + 0.15P + 0.15GT.
    const abilities = { ...abilitiesAt(40), READING_COMPREHENSION: 60, GRAMMAR: 60, VOCABULARY: 60 };
    const result = computeAdaptivePrediction(abilities, [], 1000);
    expect(result.readingWritingAbility).toBeCloseTo(60, 9);
    expect(result.mathAbility).toBeCloseTo(40, 9);
    expect(result.overallAbility).toBeCloseTo(50, 9);
  });

  it("reports a score in steps of 10 with a band that contains it", () => {
    const result = computeAdaptivePrediction(abilitiesAt(55), [], 1000);
    expect(result.point % 10).toBe(0);
    expect(result.low % 10).toBe(0);
    expect(result.high % 10).toBe(0);
    expect(result.low).toBeLessThan(result.point);
    expect(result.high).toBeGreaterThan(result.point);
    expect(Math.abs(result.point - result.totalScore)).toBeLessThanOrEqual(10);
  });

  it("measures improvement from the baseline point it's given, up or down", () => {
    const result = computeAdaptivePrediction(abilitiesAt(55), [], 1000);
    expect(result.approximateImprovement).toBe(result.point - 1000);
    expect(computeAdaptivePrediction(abilitiesAt(55), [], result.point).approximateImprovement).toBe(0);
    expect(computeAdaptivePrediction(abilitiesAt(55), [], 1560).approximateImprovement).toBeLessThan(0);
  });

  it("never predicts less for a student who is stronger in any category", () => {
    let previous = computeAdaptivePrediction(abilitiesAt(30), [], 1000).totalScore;
    for (const c of ALL_CATEGORIES) {
      const next = computeAdaptivePrediction({ ...abilitiesAt(30), [c]: 70 }, [], 1000).totalScore;
      expect(next).toBeGreaterThan(previous - 1e-9);
    }
    previous = computeAdaptivePrediction(abilitiesAt(70), [], 1000).totalScore;
    expect(previous).toBeGreaterThan(computeAdaptivePrediction(abilitiesAt(30), [], 1000).totalScore);
  });

  it("narrows its band as answers accumulate", () => {
    const few = ALL_CATEGORIES.map((category) => ({ category, difficulty: "MEDIUM" as const, isCorrect: true }));
    const many = Array.from({ length: 12 }, () => few).flat();
    const wide = computeAdaptivePrediction(abilitiesAt(50), few, 1000);
    const narrow = computeAdaptivePrediction(abilitiesAt(50), many, 1000);
    expect(narrow.high - narrow.low).toBeLessThan(wide.high - wide.low);
  });
});
