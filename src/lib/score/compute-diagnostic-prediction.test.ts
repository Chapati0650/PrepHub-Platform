import { describe, expect, it } from "vitest";
import type { QuestionCategory } from "@/generated/prisma/client";
import { computeDiagnosticPrediction } from "@/lib/score/compute-diagnostic-prediction";
import { computeAdaptivePrediction } from "@/lib/score/compute-adaptive-prediction";
import { initialAbilitiesFromDiagnostic } from "@/lib/adaptive/diagnostic-initialization";
import { ABILITY_MODEL, ALL_CATEGORIES } from "@/lib/adaptive/config";
import { diagnosticAnswers } from "@/lib/adaptive/estimate";
import { createRandom } from "@/lib/adaptive/random";
import { CATEGORY_WEIGHT, SECTION_SCORE_LINES } from "@/lib/score/config";

function abilitiesAt(value: number): Record<QuestionCategory, number> {
  return Object.fromEntries(ALL_CATEGORIES.map((c) => [c, value])) as Record<QuestionCategory, number>;
}

const at = new Date("2026-11-06T12:00:00Z");

/**
 * A staged Diagnostic as a student finishes it: Easy and Medium everywhere,
 * the Hard question served only where the Medium was right and waived
 * elsewhere. `bonus` says how each earned Hard question went.
 */
function stagedDiagnostic(core: Record<QuestionCategory, [boolean, boolean]>, bonus: Partial<Record<QuestionCategory, boolean>>) {
  return ALL_CATEGORIES.flatMap((category) => {
    const [easy, medium] = core[category];
    const earned = medium;
    return [
      { category, difficulty: "EASY" as const, isCorrect: easy, submittedAt: at, waivedAt: null },
      { category, difficulty: "MEDIUM" as const, isCorrect: medium, submittedAt: at, waivedAt: null },
      {
        category,
        difficulty: "HARD" as const,
        isCorrect: earned ? (bonus[category] ?? false) : null,
        submittedAt: earned ? at : null,
        waivedAt: earned ? null : at,
      },
    ];
  });
}

const predictFrom = (attempts: ReturnType<typeof stagedDiagnostic>) =>
  computeDiagnosticPrediction(initialAbilitiesFromDiagnostic(attempts), diagnosticAnswers(attempts));

describe("computeDiagnosticPrediction", () => {
  it("puts a typical PrepHub student (every category at the population mean) near 1010", () => {
    const result = computeDiagnosticPrediction(abilitiesAt(ABILITY_MODEL.populationMean), []);
    expect(result.totalScore).toBeGreaterThan(980);
    expect(result.totalScore).toBeLessThan(1040);
    expect(result.low).toBeLessThanOrEqual(result.point);
  });

  it("scores the two sections on their own lines, reports each to the nearest 10, and adds them", () => {
    const result = computeDiagnosticPrediction(abilitiesAt(60), []);
    const rw = SECTION_SCORE_LINES.READING_WRITING.intercept + SECTION_SCORE_LINES.READING_WRITING.slope * 60;
    const math = SECTION_SCORE_LINES.MATH.intercept + SECTION_SCORE_LINES.MATH.slope * 60;
    expect(result.totalScore).toBeCloseTo(rw + math, 9);
    expect(result.readingWritingScore).toBe(Math.round(rw / 10) * 10);
    expect(result.mathScore).toBe(Math.round(math / 10) * 10);
    expect(result.point).toBe(result.readingWritingScore + result.mathScore);
  });

  it("weights a category by its share of its section, and leaves the other section alone", () => {
    const base = computeDiagnosticPrediction(abilitiesAt(50), []);
    const raised = computeDiagnosticPrediction({ ...abilitiesAt(50), GRAMMAR: 60 }, []);
    expect(raised.readingWritingAbility - base.readingWritingAbility).toBeCloseTo(CATEGORY_WEIGHT.GRAMMAR * 10, 9);
    expect(raised.totalScore - base.totalScore).toBeCloseTo(CATEGORY_WEIGHT.GRAMMAR * 10 * SECTION_SCORE_LINES.READING_WRITING.slope, 9);
    expect(raised.mathScore).toBe(base.mathScore);
  });

  it("keeps every prediction on the 400-1600 scale, band included", () => {
    for (const ability of [0, 100]) {
      const r = computeDiagnosticPrediction(abilitiesAt(ability), []);
      expect(r.point).toBe(ability === 0 ? 400 : 1600);
      expect(r.low).toBeGreaterThanOrEqual(400);
      expect(r.high).toBeLessThanOrEqual(1600);
      expect(r.readingWriting.low).toBeGreaterThanOrEqual(200);
      expect(r.math.high).toBeLessThanOrEqual(800);
    }
  });

  it("is exactly what a Practice Set predicts from the same abilities — a set that changes nothing moves nothing", () => {
    const random = createRandom("no-jump");
    for (let trial = 0; trial < 25; trial++) {
      const abilities = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 20 + random() * 60])) as Record<QuestionCategory, number>;
      const diagnostic = computeDiagnosticPrediction(abilities, []);
      const practice = computeAdaptivePrediction(abilities, [], diagnostic.point);
      expect(practice.point).toBe(diagnostic.point);
      expect(practice.low).toBe(diagnostic.low);
      expect(practice.high).toBe(diagnostic.high);
      expect(practice.totalScore).toBe(diagnostic.totalScore);
      expect(practice.approximateImprovement).toBe(0);
    }
  });
});

describe("the bonus round's promise: these can only raise your predicted score", () => {
  it("holds for every earned bonus question, across many Diagnostics", () => {
    const random = createRandom("bonus-promise");
    for (let trial = 0; trial < 60; trial++) {
      const core = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, [random() < 0.78, random() < 0.57]])) as Record<
        QuestionCategory,
        [boolean, boolean]
      >;
      const earned = ALL_CATEGORIES.filter((c) => core[c][1]);
      const bonus = Object.fromEntries(earned.map((c) => [c, random() < 0.41])) as Partial<Record<QuestionCategory, boolean>>;
      const predict = (b: Partial<Record<QuestionCategory, boolean>>) => predictFrom(stagedDiagnostic(core, b));

      // Against the score with every earned bonus question wrong — which is
      // also what a student who didn't try one would get.
      const floor = predict({});
      const actual = predict(bonus);
      expect(actual.totalScore).toBeGreaterThanOrEqual(floor.totalScore - 1e-9);
      expect(actual.point).toBeGreaterThanOrEqual(floor.point);

      // And one at a time: getting any single one right never costs anything.
      for (const c of earned) {
        if (bonus[c]) continue;
        expect(predict({ ...bonus, [c]: true }).totalScore).toBeGreaterThan(actual.totalScore);
      }
    }
  });

  it("never scores a waived question as a miss", () => {
    // Medium wrong in every category, so every Hard is waived: the same
    // prediction as if those rows didn't exist at all.
    const core = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, [true, false]])) as Record<QuestionCategory, [boolean, boolean]>;
    const attempts = stagedDiagnostic(core, {});
    const withoutWaived = attempts.filter((a) => a.waivedAt === null);
    expect(predictFrom(attempts)).toEqual(predictFrom(withoutWaived));
  });
});
