import { describe, expect, it } from "vitest";
import { computeAbilityUpdate, expectedProbability } from "@/lib/adaptive/ability";
import { ABILITY_LOGISTIC_SCALE, DIFFICULTY_RATING, ONLINE_STARTING_SD, kValueFor } from "@/lib/adaptive/config";

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

describe("DIFFICULTY_RATING", () => {
  it("rises from Easy to Hard in every category", () => {
    for (const ratings of Object.values(DIFFICULTY_RATING)) {
      expect(ratings.EASY).toBeLessThan(ratings.MEDIUM);
      expect(ratings.MEDIUM).toBeLessThan(ratings.HARD);
    }
  });
});

describe("computeAbilityUpdate", () => {
  const update = (overrides: Partial<Parameters<typeof computeAbilityUpdate>[0]>) =>
    computeAbilityUpdate({
      abilityBefore: 50,
      category: "ALGEBRA",
      difficulty: "MEDIUM",
      isCorrect: true,
      previousAdaptiveAnswersInCategory: 0,
      ...overrides,
    });

  it("increases ability on a correct answer", () => {
    expect(update({ isCorrect: true }).abilityAfter).toBeGreaterThan(50);
  });

  it("decreases ability on an incorrect answer", () => {
    expect(update({ isCorrect: false }).abilityAfter).toBeLessThan(50);
  });

  it("produces a larger change for an unexpected result than an expected one", () => {
    // Correct on a Hard question while ability is low (unexpected win) vs.
    // correct on an Easy question while ability is already high (expected win).
    const unexpected = update({ abilityBefore: 20, difficulty: "HARD" });
    const expectedWin = update({ abilityBefore: 95, difficulty: "EASY" });
    expect(Math.abs(unexpected.appliedAbilityChange)).toBeGreaterThan(Math.abs(expectedWin.appliedAbilityChange));
  });

  it("reads the question's rating for its own category", () => {
    // The same Medium question is far easier in Vocabulary than in Geometry.
    const vocabulary = update({ category: "VOCABULARY" });
    const geometry = update({ category: "GEOMETRY_TRIGONOMETRY" });
    expect(vocabulary.expectedProbability).toBeCloseTo(expectedProbability(DIFFICULTY_RATING.VOCABULARY.MEDIUM, 50), 9);
    expect(vocabulary.expectedProbability).toBeGreaterThan(geometry.expectedProbability);
  });

  it("never changes ability by more than the evidence of one answer supports", () => {
    // The largest possible surprise: a right answer to a Hard question at 0.
    const result = update({ abilityBefore: 0, difficulty: "HARD", isCorrect: true });
    expect(result.appliedAbilityChange).toBeLessThanOrEqual(kValueFor(0));
    expect(result.appliedAbilityChange).toBeLessThan(2);
  });

  it("clamps ability at the 0 floor", () => {
    const result = update({ abilityBefore: 0, difficulty: "HARD", isCorrect: false });
    expect(result.rawAbilityChange).toBeLessThan(0);
    expect(result.abilityAfter).toBe(0);
  });

  it("clamps ability at the 100 ceiling", () => {
    const result = update({ abilityBefore: 100, difficulty: "EASY", isCorrect: true });
    expect(result.rawAbilityChange).toBeGreaterThan(0);
    expect(result.abilityAfter).toBe(100);
  });
});

describe("kValueFor", () => {
  it("is the logistic scale times the starting variance before any answers", () => {
    expect(kValueFor(0)).toBeCloseTo(ABILITY_LOGISTIC_SCALE * ONLINE_STARTING_SD ** 2, 9);
  });

  it("shrinks with every answer already given, and never reaches zero", () => {
    let previous = kValueFor(0);
    for (const n of [1, 5, 10, 30, 100, 1000]) {
      const k = kValueFor(n);
      expect(k).toBeLessThan(previous);
      expect(k).toBeGreaterThan(0);
      previous = k;
    }
  });
});
