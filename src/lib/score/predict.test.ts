import { describe, expect, it } from "vitest";
import type { QuestionCategory } from "@/generated/prisma/client";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import type { ScoredAnswer } from "@/lib/adaptive/estimate";
import { predictScore } from "@/lib/score/predict";
import { abilityForSectionScore } from "@/lib/score/config";

function abilitiesAt(value: number): Record<QuestionCategory, number> {
  return Object.fromEntries(ALL_CATEGORIES.map((c) => [c, value])) as Record<QuestionCategory, number>;
}

const answers = (n: number): ScoredAnswer[] =>
  Array.from({ length: n }, (_, i) => ({
    category: ALL_CATEGORIES[i % ALL_CATEGORIES.length],
    difficulty: (["EASY", "MEDIUM", "HARD"] as const)[i % 3],
    isCorrect: i % 2 === 0,
  }));

describe("predictScore", () => {
  it("reports sections in steps of 10 and the total as their sum", () => {
    for (const ability of [12, 33, 47, 58, 71, 90]) {
      const p = predictScore(abilitiesAt(ability), answers(60));
      expect(p.readingWritingScore % 10).toBe(0);
      expect(p.mathScore % 10).toBe(0);
      expect(p.point).toBe(p.readingWritingScore + p.mathScore);
      expect(p.readingWriting.score).toBe(p.readingWritingScore);
      expect(p.math.score).toBe(p.mathScore);
    }
  });

  it("keeps the band around the score, in steps of 10, on the real scales", () => {
    for (const ability of [0, 10, 40, 60, 90, 100]) {
      const p = predictScore(abilitiesAt(ability), answers(30));
      expect(p.low % 10).toBe(0);
      expect(p.high % 10).toBe(0);
      expect(p.low).toBeLessThanOrEqual(p.point);
      expect(p.high).toBeGreaterThanOrEqual(p.point);
      expect(p.low).toBeGreaterThanOrEqual(400);
      expect(p.high).toBeLessThanOrEqual(1600);
      for (const s of [p.readingWriting, p.math]) {
        expect(s.low).toBeGreaterThanOrEqual(200);
        expect(s.high).toBeLessThanOrEqual(800);
        expect(s.low).toBeLessThanOrEqual(s.score);
        expect(s.high).toBeGreaterThanOrEqual(s.score);
      }
    }
  });

  it("is never narrower than one step either side in the middle of the scale, however much evidence", () => {
    const p = predictScore(abilitiesAt(50), answers(20000));
    expect(p.point - p.low).toBeGreaterThanOrEqual(10);
    expect(p.high - p.point).toBeGreaterThanOrEqual(10);
  });

  it("pins the band at the edges of the scale instead of passing them", () => {
    const top = predictScore(abilitiesAt(100), []);
    expect(top.point).toBe(1600);
    expect(top.high).toBe(1600);
    expect(top.low).toBeLessThan(1600);
    const bottom = predictScore(abilitiesAt(0), []);
    expect(bottom.point).toBe(400);
    expect(bottom.low).toBe(400);
    expect(bottom.high).toBeGreaterThan(400);
  });

  it("gives a wider band to a student with less evidence, and the same score", () => {
    const few = predictScore(abilitiesAt(50), answers(14));
    const many = predictScore(abilitiesAt(50), answers(700));
    expect(many.point).toBe(few.point);
    expect(many.high - many.low).toBeLessThan(few.high - few.low);
  });

  it("with no answers uses the prior's wide band", () => {
    const p = predictScore(abilitiesAt(50));
    expect(p.high - p.low).toBeGreaterThan(200);
  });

  it("reads a score at the middle of a section's range back from the ability that produces it", () => {
    const p = predictScore(abilitiesAt(abilityForSectionScore("MATH", 600)), []);
    expect(p.mathScore).toBe(600);
  });

  it("uses a band for the total that combines the two sections as independent", () => {
    const p = predictScore(abilitiesAt(50), answers(40));
    const sectionHalf = Math.max(p.readingWriting.high - p.readingWriting.score, p.math.high - p.math.score);
    // Independent sections: the total's half-width is more than either section's but less than their sum.
    expect(p.high - p.point).toBeGreaterThanOrEqual(sectionHalf - 10);
    expect(p.high - p.point).toBeLessThan(
      p.readingWriting.high - p.readingWriting.score + (p.math.high - p.math.score),
    );
  });
});
