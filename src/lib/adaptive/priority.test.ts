import { describe, expect, it } from "vitest";
import { focusRecencyScore, priorityScore, recentStruggleScore, weaknessScore } from "@/lib/adaptive/priority";

describe("weaknessScore", () => {
  it("is 100 minus ability", () => {
    expect(weaknessScore(30)).toBe(70);
    expect(weaknessScore(0)).toBe(100);
    expect(weaknessScore(100)).toBe(0);
  });
});

describe("recentStruggleScore", () => {
  it("returns 0 when there are no adaptive answers yet", () => {
    expect(recentStruggleScore([])).toBe(0);
  });

  it("is higher when the student performed worse than expected", () => {
    // Expected to succeed (high E) but got it wrong — a real struggle.
    const struggled = recentStruggleScore([{ expectedProbability: 0.9, isCorrect: false }]);
    // Expected to fail (low E) but got it right — outperformed expectations.
    const outperformed = recentStruggleScore([{ expectedProbability: 0.1, isCorrect: true }]);
    expect(struggled).toBeGreaterThan(outperformed);
  });

  it("lets a correct answer offset recent unexpected mistakes", () => {
    const mixed = recentStruggleScore([
      { expectedProbability: 0.8, isCorrect: false },
      { expectedProbability: 0.8, isCorrect: true },
    ]);
    const onlyMistake = recentStruggleScore([{ expectedProbability: 0.8, isCorrect: false }]);
    expect(mixed).toBeLessThan(onlyMistake);
  });

  it("clamps to the 0-100 range", () => {
    const allUnexpectedWrong = recentStruggleScore(
      Array.from({ length: 5 }, () => ({ expectedProbability: 1.0, isCorrect: false })),
    );
    expect(allUnexpectedWrong).toBeLessThanOrEqual(100);
    const allUnexpectedRight = recentStruggleScore(
      Array.from({ length: 5 }, () => ({ expectedProbability: 0.0, isCorrect: true })),
    );
    expect(allUnexpectedRight).toBeGreaterThanOrEqual(0);
  });
});

describe("focusRecencyScore", () => {
  it.each([
    [0, 0],
    [1, 25],
    [2, 50],
    [3, 75],
    [4, 100],
    [10, 100],
  ])("consecutiveSets=%s -> %s", (n, expected) => {
    expect(focusRecencyScore(n)).toBe(expected);
  });
});

describe("priorityScore", () => {
  it("weights weakness at 80%, struggle at 15%, focus at 5%", () => {
    expect(priorityScore(100, 0, 0)).toBeCloseTo(80, 6);
    expect(priorityScore(0, 100, 0)).toBeCloseTo(15, 6);
    expect(priorityScore(0, 0, 100)).toBeCloseTo(5, 6);
    expect(priorityScore(50, 50, 50)).toBeCloseTo(50, 6);
  });
});
