import { describe, expect, it } from "vitest";
import { computeAbilityUpdate, expectedProbability } from "@/lib/adaptive/ability";

describe("expectedProbability", () => {
  it("returns 0.5 when question rating equals ability", () => {
    expect(expectedProbability(60, 60)).toBeCloseTo(0.5, 6);
  });

  it("returns a higher probability when ability exceeds the question rating", () => {
    expect(expectedProbability(35, 85)).toBeGreaterThan(0.9);
  });

  it("returns a lower probability when the question rating exceeds ability", () => {
    expect(expectedProbability(85, 35)).toBeLessThan(0.1);
  });
});

describe("computeAbilityUpdate", () => {
  it("increases ability on a correct answer", () => {
    const result = computeAbilityUpdate({
      abilityBefore: 50,
      difficulty: "MEDIUM",
      isCorrect: true,
      previousAdaptiveAnswersInCategory: 0,
    });
    expect(result.abilityAfter).toBeGreaterThan(50);
  });

  it("decreases ability on an incorrect answer", () => {
    const result = computeAbilityUpdate({
      abilityBefore: 50,
      difficulty: "MEDIUM",
      isCorrect: false,
      previousAdaptiveAnswersInCategory: 0,
    });
    expect(result.abilityAfter).toBeLessThan(50);
  });

  it("produces a larger change for an unexpected result than an expected one", () => {
    // Correct on a Hard question while ability is low (unexpected win) vs.
    // correct on an Easy question while ability is already high (expected win).
    const unexpected = computeAbilityUpdate({
      abilityBefore: 20,
      difficulty: "HARD",
      isCorrect: true,
      previousAdaptiveAnswersInCategory: 0,
    });
    const expectedWin = computeAbilityUpdate({
      abilityBefore: 95,
      difficulty: "EASY",
      isCorrect: true,
      previousAdaptiveAnswersInCategory: 0,
    });
    expect(Math.abs(unexpected.appliedAbilityChange)).toBeGreaterThan(Math.abs(expectedWin.appliedAbilityChange));
  });

  it("never changes ability by more than 5 points, even at K=10 with a maximally unexpected result", () => {
    const result = computeAbilityUpdate({
      abilityBefore: 0,
      difficulty: "HARD",
      isCorrect: true,
      previousAdaptiveAnswersInCategory: 0,
    });
    expect(Math.abs(result.appliedAbilityChange)).toBeLessThanOrEqual(5);
    expect(result.rawAbilityChange).toBeGreaterThan(5); // raw exceeds the cap before clamping
  });

  it("clamps ability at the 0 floor", () => {
    // Already at the floor, and a wrong answer pushes further negative —
    // the clamp must hold it at exactly 0 rather than going negative.
    const result = computeAbilityUpdate({
      abilityBefore: 0,
      difficulty: "HARD",
      isCorrect: false,
      previousAdaptiveAnswersInCategory: 0,
    });
    expect(result.rawAbilityChange).toBeLessThan(0);
    expect(result.abilityAfter).toBe(0);
  });

  it("clamps ability at the 100 ceiling", () => {
    // Already at the ceiling, and a correct answer pushes further positive —
    // the clamp must hold it at exactly 100 rather than exceeding it.
    const result = computeAbilityUpdate({
      abilityBefore: 100,
      difficulty: "EASY",
      isCorrect: true,
      previousAdaptiveAnswersInCategory: 0,
    });
    expect(result.rawAbilityChange).toBeGreaterThan(0);
    expect(result.abilityAfter).toBe(100);
  });

  it("selects K=10 for the 10th adaptive answer (0-9 previous answers)", () => {
    const result = computeAbilityUpdate({
      abilityBefore: 50,
      difficulty: "MEDIUM",
      isCorrect: true,
      previousAdaptiveAnswersInCategory: 9,
    });
    expect(result.kValue).toBe(10.0);
  });

  it("selects K=8 for the 11th adaptive answer (10-29 previous answers)", () => {
    const result = computeAbilityUpdate({
      abilityBefore: 50,
      difficulty: "MEDIUM",
      isCorrect: true,
      previousAdaptiveAnswersInCategory: 10,
    });
    expect(result.kValue).toBe(8.0);
  });

  it("selects K=6 once 30 or more previous answers exist", () => {
    const result = computeAbilityUpdate({
      abilityBefore: 50,
      difficulty: "MEDIUM",
      isCorrect: true,
      previousAdaptiveAnswersInCategory: 30,
    });
    expect(result.kValue).toBe(6.0);
  });
});
