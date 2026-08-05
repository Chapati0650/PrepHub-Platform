import { describe, expect, it } from "vitest";
import { progressWithinRange, rangeForAbility, rangeForScore, SCORE_RANGES, validateScoreConfig } from "@/lib/score/config";

describe("validateScoreConfig", () => {
  it("passes for the shipped V1 configuration", () => {
    expect(() => validateScoreConfig()).not.toThrow();
  });
});

describe("rangeForScore", () => {
  it("maps the lower and upper boundary of every range to itself", () => {
    for (const range of SCORE_RANGES) {
      expect(rangeForScore(range.scoreMin).index).toBe(range.index);
      expect(rangeForScore(range.scoreMax).index).toBe(range.index);
    }
  });

  it("maps 1600 to the top range and 400 to the bottom range", () => {
    expect(rangeForScore(1600).index).toBe(15);
    expect(rangeForScore(400).index).toBe(1);
  });

  it("maps the internal diagnostic estimate 1529 (just under the 1530 band) to the 1450-1520 band, per §5.4's contiguous internal-estimate boundaries", () => {
    expect(rangeForScore(1529).index).toBe(14);
    expect(rangeForScore(1530).index).toBe(15);
  });
});

describe("rangeForAbility", () => {
  it("maps the lower boundary of every ability band to itself, and is inclusive at the very top", () => {
    for (const range of SCORE_RANGES) {
      expect(rangeForAbility(range.abilityMin).index).toBe(range.index);
    }
    expect(rangeForAbility(100.0).index).toBe(15);
    expect(rangeForAbility(0.0).index).toBe(1);
  });

  it("maps a value just under a band's ceiling to that band, not the next one", () => {
    expect(rangeForAbility(81.999).index).toBe(13); // just under 82 -> still band 13 (70-82)
    expect(rangeForAbility(82.0).index).toBe(14);
  });
});

describe("progressWithinRange", () => {
  it("matches the PRD-016 §8.1 worked example: ability 76 in band 70-82 -> 0.50", () => {
    expect(progressWithinRange(76, 70, 82)).toBeCloseTo(0.5, 6);
  });

  it("clamps to 0 and 1 at the boundaries", () => {
    expect(progressWithinRange(70, 70, 82)).toBe(0);
    expect(progressWithinRange(82, 70, 82)).toBe(1);
    expect(progressWithinRange(200, 70, 82)).toBe(1);
    expect(progressWithinRange(-5, 70, 82)).toBe(0);
  });
});
