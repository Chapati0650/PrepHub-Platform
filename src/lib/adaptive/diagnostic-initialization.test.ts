import { describe, expect, it } from "vitest";
import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import {
  DIAGNOSTIC_CEILING,
  abilitiesFromHistory,
  diagnosticStartingPoint,
  initialAbilitiesFromDiagnostic,
} from "@/lib/adaptive/diagnostic-initialization";
import { estimateAbilities, type ScoredAnswer } from "@/lib/adaptive/estimate";
import { ABILITY_MODEL, ALL_CATEGORIES, CATEGORY_SECTION } from "@/lib/adaptive/config";
import { predictScore } from "@/lib/score/predict";

const at = new Date("2026-11-06T12:00:00Z");

function attempt(category: QuestionCategory, difficulty: QuestionDifficulty, isCorrect: boolean | null, extra: { waived?: boolean; unanswered?: boolean } = {}) {
  return {
    category,
    difficulty,
    isCorrect,
    submittedAt: extra.unanswered || extra.waived ? null : at,
    waivedAt: extra.waived ? at : null,
  };
}

/** Every question right, every bonus question earned and right. */
function perfect(): ScoredAnswer[] {
  return ALL_CATEGORIES.flatMap((category) =>
    (["EASY", "MEDIUM", "HARD"] as const).map((difficulty) => ({ category, difficulty, isCorrect: true })),
  );
}

/** Misses `difficulty` in `category`; a missed Medium waives that category's Hard question. */
function missing(answers: ScoredAnswer[], category: QuestionCategory, difficulty: QuestionDifficulty): ScoredAnswer[] {
  return answers.flatMap((a) => {
    if (a.category !== category) return [a];
    if (a.difficulty === difficulty) return [{ ...a, isCorrect: false }];
    if (difficulty === "MEDIUM" && a.difficulty === "HARD") return [];
    return [a];
  });
}

const predicted = (diagnostic: ScoredAnswer[], practice: ScoredAnswer[] = []) =>
  predictScore(abilitiesFromHistory(diagnostic, practice), [...diagnostic, ...practice]);

describe("a perfect Diagnostic", () => {
  it("predicts the top of the scale", () => {
    const result = predicted(perfect());
    expect(result.point).toBeGreaterThanOrEqual(1530);
    expect(result.high).toBe(1600);
  });

  it("stays in the top range through a practice set of hard questions answered right", () => {
    const practice = ALL_CATEGORIES.flatMap((category) =>
      (["HARD", "HARD", "MEDIUM"] as const).map((difficulty) => ({ category, difficulty, isCorrect: true })),
    );
    expect(predicted(perfect(), practice).point).toBeGreaterThanOrEqual(1530);
  });

  it("comes down with the evidence when practice says otherwise", () => {
    // Half the hard questions missed, three sets running.
    const practice = Array.from({ length: 3 }, () =>
      ALL_CATEGORIES.flatMap((category) => [
        { category, difficulty: "HARD" as const, isCorrect: true },
        { category, difficulty: "HARD" as const, isCorrect: false },
        { category, difficulty: "MEDIUM" as const, isCorrect: true },
      ]),
    ).flat();
    const after = predicted(perfect(), practice);
    expect(after.totalScore).toBeLessThan(predicted(perfect()).totalScore - 100);
  });
});

describe("near the ceiling", () => {
  it("costs about one range per miss rather than falling off a cliff", () => {
    const top = predicted(perfect()).totalScore;
    const oneMiss = predicted(missing(perfect(), "ALGEBRA", "HARD")).totalScore;
    const twoMisses = predicted(missing(missing(perfect(), "ALGEBRA", "HARD"), "ADVANCED_MATH", "HARD")).totalScore;
    expect(oneMiss).toBeLessThan(top);
    expect(twoMisses).toBeLessThan(oneMiss);
    expect(top - oneMiss).toBeLessThan(150);
    expect(oneMiss - twoMisses).toBeLessThan(150);
    expect(oneMiss).toBeGreaterThanOrEqual(1450);
  });

  it("is the calibrated model, unchanged, once a section has two misses", () => {
    const answers = missing(missing(perfect(), "ALGEBRA", "HARD"), "ADVANCED_MATH", "EASY");
    expect(diagnosticStartingPoint(answers).MATH).toBeUndefined();
    expect(diagnosticStartingPoint(answers).READING_WRITING).toBeDefined();
  });

  it("doesn't apply to a section with a missed Medium, whose Hard question was never served", () => {
    // Every other answer right: the student never met that category's hardest question.
    expect(diagnosticStartingPoint(missing(perfect(), "GRAMMAR", "MEDIUM")).READING_WRITING).toBeUndefined();
  });

  it("never applies to a section where no Hard question was served", () => {
    const easyAndMedium = ALL_CATEGORIES.flatMap((category) =>
      (["EASY", "MEDIUM"] as const).map((difficulty) => ({ category, difficulty, isCorrect: true })),
    );
    expect(diagnosticStartingPoint(easyAndMedium)).toEqual({});
    expect(abilitiesFromHistory(easyAndMedium)).toEqual(estimateAbilities(easyAndMedium));
  });

  it("starts each section independently", () => {
    // Reading & Writing perfect, Math full of misses.
    let answers = perfect();
    for (const c of ALL_CATEGORIES.filter((c) => CATEGORY_SECTION[c] === "MATH")) answers = missing(answers, c, "MEDIUM");
    const start = diagnosticStartingPoint(answers);
    expect(start.READING_WRITING).toBeGreaterThan(ABILITY_MODEL.populationMean);
    expect(start.MATH).toBeUndefined();
    const result = predicted(answers);
    expect(result.readingWritingScore).toBeGreaterThan(DIAGNOSTIC_CEILING.sectionScore - 20);
    expect(result.mathScore).toBeLessThan(600);
  });
});

describe("initialAbilitiesFromDiagnostic", () => {
  it("is the same estimate every Practice Set uses, over the answered questions", () => {
    const attempts = [attempt("ALGEBRA", "EASY", true), attempt("ALGEBRA", "MEDIUM", false), attempt("GRAMMAR", "EASY", true)];
    expect(initialAbilitiesFromDiagnostic(attempts)).toEqual(
      abilitiesFromHistory([
        { category: "ALGEBRA", difficulty: "EASY", isCorrect: true },
        { category: "ALGEBRA", difficulty: "MEDIUM", isCorrect: false },
        { category: "GRAMMAR", difficulty: "EASY", isCorrect: true },
      ]),
    );
  });

  it("leaves out a waived bonus question rather than counting it wrong", () => {
    const core = [attempt("ALGEBRA", "EASY", true), attempt("ALGEBRA", "MEDIUM", false)];
    expect(initialAbilitiesFromDiagnostic([...core, attempt("ALGEBRA", "HARD", null, { waived: true })])).toEqual(
      initialAbilitiesFromDiagnostic(core),
    );
  });

  it("leaves out a question that was never answered", () => {
    const core = [attempt("ADVANCED_MATH", "EASY", false)];
    expect(initialAbilitiesFromDiagnostic([...core, attempt("ADVANCED_MATH", "MEDIUM", null, { unanswered: true })])).toEqual(
      initialAbilitiesFromDiagnostic(core),
    );
  });

  it("counts a submitted blank as a wrong answer", () => {
    expect(initialAbilitiesFromDiagnostic([attempt("VOCABULARY", "EASY", null)])).toEqual(
      initialAbilitiesFromDiagnostic([attempt("VOCABULARY", "EASY", false)]),
    );
  });
});
