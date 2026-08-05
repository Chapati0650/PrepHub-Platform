import { describe, expect, it } from "vitest";
import { computeAdaptivePrediction } from "@/lib/score/compute-adaptive-prediction";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import type { QuestionCategory } from "@/generated/prisma/client";

function abilitiesAt(value: number): Record<QuestionCategory, number> {
  return Object.fromEntries(ALL_CATEGORIES.map((c) => [c, value])) as Record<QuestionCategory, number>;
}

describe("computeAdaptivePrediction", () => {
  it("maps Overall Ability 100 to the top range and 0 to the bottom range", () => {
    const top = computeAdaptivePrediction(abilitiesAt(100), 440);
    expect(top.overallAbility).toBe(100);
    expect(top.range.index).toBe(15);

    const bottom = computeAdaptivePrediction(abilitiesAt(0), 1565);
    expect(bottom.overallAbility).toBe(0);
    expect(bottom.range.index).toBe(1);
  });

  it("matches the PRD-016 §8.1 worked example: Overall Ability 76 -> band 70-82, progress 0.50", () => {
    const abilities = abilitiesAt(0);
    // RW = 0.45R + 0.45G + 0.10V, Math = 0.35A + 0.35AM + 0.15P + 0.15GT.
    // Setting every category to 76 makes both RW and Math equal 76, so
    // Overall Ability = 76 regardless of the weighting split.
    for (const c of ALL_CATEGORIES) abilities[c] = 76;

    const result = computeAdaptivePrediction(abilities, 440);
    expect(result.overallAbility).toBeCloseTo(76, 6);
    expect(result.range.index).toBe(13); // 1370-1440, ability band 70-82
    expect(result.withinRangeProgress).toBeCloseTo(0.5, 6);
  });

  it("computes a positive approximate improvement when the current range midpoint exceeds the initial one", () => {
    // Overall Ability 65 -> range 1290-1360 (midpoint 1325); initial baseline 1165.
    const result = computeAdaptivePrediction(abilitiesAt(65), 1165);
    expect(result.range.midpoint).toBe(1325);
    expect(result.approximateImprovement).toBe(160);
  });

  it("computes a negative approximate improvement (score decrease) and still reports it", () => {
    // Overall Ability 65 -> range 1290-1360 (midpoint 1325); initial baseline 1405 (higher).
    const result = computeAdaptivePrediction(abilitiesAt(65), 1405);
    expect(result.approximateImprovement).toBe(-80);
  });

  it("reports zero improvement when the student remains in the same range", () => {
    const result = computeAdaptivePrediction(abilitiesAt(65), 1325);
    expect(result.approximateImprovement).toBe(0);
  });
});
