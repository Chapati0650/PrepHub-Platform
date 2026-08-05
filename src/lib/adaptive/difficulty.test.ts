import { describe, expect, it } from "vitest";
import { sampleDifficulty } from "@/lib/adaptive/difficulty";

function fixedRandom(value: number): () => number {
  return () => value;
}

describe("sampleDifficulty", () => {
  // Ability band [0, 30): easy .75 / medium .25 / hard 0
  it("samples within the lowest ability band using its distribution boundaries", () => {
    expect(sampleDifficulty(15, fixedRandom(0.0))).toBe("EASY");
    expect(sampleDifficulty(15, fixedRandom(0.74))).toBe("EASY");
    expect(sampleDifficulty(15, fixedRandom(0.76))).toBe("MEDIUM");
    expect(sampleDifficulty(15, fixedRandom(0.99))).toBe("MEDIUM");
    // Hard weight is 0 in this band — never reachable.
  });

  // Ability band [45, 60): easy .4 / medium .5 / hard .1
  it("samples within a mid ability band using its distribution boundaries", () => {
    expect(sampleDifficulty(50, fixedRandom(0.0))).toBe("EASY");
    expect(sampleDifficulty(50, fixedRandom(0.39))).toBe("EASY");
    expect(sampleDifficulty(50, fixedRandom(0.41))).toBe("MEDIUM");
    expect(sampleDifficulty(50, fixedRandom(0.89))).toBe("MEDIUM");
    expect(sampleDifficulty(50, fixedRandom(0.91))).toBe("HARD");
    expect(sampleDifficulty(50, fixedRandom(0.999))).toBe("HARD");
  });

  // Ability band [90, 100]: easy .05 / medium .35 / hard .6 — highest ability
  // skews heavily toward Hard.
  it("skews toward Hard in the highest ability band, including ability=100", () => {
    expect(sampleDifficulty(95, fixedRandom(0.04))).toBe("EASY");
    expect(sampleDifficulty(95, fixedRandom(0.06))).toBe("MEDIUM");
    expect(sampleDifficulty(95, fixedRandom(0.99))).toBe("HARD");
    expect(sampleDifficulty(100, fixedRandom(0.99))).toBe("HARD");
  });

  it("never crashes and always returns a valid difficulty across the full ability range with real randomness", () => {
    let seed = 1;
    const pseudoRandom = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let ability = 0; ability <= 100; ability += 5) {
      for (let i = 0; i < 20; i++) {
        const result = sampleDifficulty(ability, pseudoRandom);
        expect(["EASY", "MEDIUM", "HARD"]).toContain(result);
      }
    }
  });
});
