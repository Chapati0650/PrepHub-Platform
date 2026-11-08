import { describe, expect, it } from "vitest";
import { sampleDifficulty } from "@/lib/adaptive/difficulty";
import { ALL_CATEGORIES, DIFFICULTY_RATING } from "@/lib/adaptive/config";

function fixedRandom(value: number): () => number {
  return () => value;
}

// Bands are measured from the category's own Medium rating.
const ALGEBRA_MEDIUM = DIFFICULTY_RATING.ALGEBRA.MEDIUM;

describe("sampleDifficulty", () => {
  // Offset below -30: easy .75 / medium .25 / hard 0
  it("samples within the lowest band using its distribution boundaries", () => {
    const ability = ALGEBRA_MEDIUM - 35;
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.0))).toBe("EASY");
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.74))).toBe("EASY");
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.76))).toBe("MEDIUM");
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.99))).toBe("MEDIUM");
    // Hard weight is 0 in this band — never reachable.
  });

  // Offset [-15, 0): easy .4 / medium .5 / hard .1
  it("samples within a middle band using its distribution boundaries", () => {
    const ability = ALGEBRA_MEDIUM - 5;
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.0))).toBe("EASY");
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.39))).toBe("EASY");
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.41))).toBe("MEDIUM");
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.89))).toBe("MEDIUM");
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.91))).toBe("HARD");
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.999))).toBe("HARD");
  });

  // Offset 30 and up: easy .05 / medium .35 / hard .6
  it("skews toward Hard in the highest band, including ability=100", () => {
    const ability = ALGEBRA_MEDIUM + 35;
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.04))).toBe("EASY");
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.06))).toBe("MEDIUM");
    expect(sampleDifficulty(ability, "ALGEBRA", fixedRandom(0.99))).toBe("HARD");
    expect(sampleDifficulty(100, "ALGEBRA", fixedRandom(0.99))).toBe("HARD");
  });

  it("pitches the same ability harder in a category whose questions are easier", () => {
    // Ability 50 is well above Vocabulary's Medium rating and a little below
    // Geometry's, so Vocabulary can draw Hard where Geometry mostly can't.
    expect(DIFFICULTY_RATING.VOCABULARY.MEDIUM).toBeLessThan(DIFFICULTY_RATING.GEOMETRY_TRIGONOMETRY.MEDIUM);
    expect(sampleDifficulty(50, "VOCABULARY", fixedRandom(0.8))).toBe("HARD");
    expect(sampleDifficulty(50, "GEOMETRY_TRIGONOMETRY", fixedRandom(0.8))).toBe("MEDIUM");
  });

  it("never crashes and always returns a valid difficulty across the full ability range with real randomness", () => {
    let seed = 1;
    const pseudoRandom = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (const category of ALL_CATEGORIES) {
      for (let ability = 0; ability <= 100; ability += 5) {
        for (let i = 0; i < 20; i++) {
          expect(["EASY", "MEDIUM", "HARD"]).toContain(sampleDifficulty(ability, category, pseudoRandom));
        }
      }
    }
  });
});
