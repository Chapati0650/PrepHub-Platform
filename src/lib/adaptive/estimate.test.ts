import { describe, expect, it } from "vitest";
import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { estimateAbilities, type ScoredAnswer } from "@/lib/adaptive/estimate";
import { expectedProbability } from "@/lib/adaptive/ability";
import { ABILITY_LOGISTIC_SCALE, ABILITY_MODEL, ALL_CATEGORIES, CATEGORY_SECTION, questionRating } from "@/lib/adaptive/config";
import { createRandom } from "@/lib/adaptive/random";

const answer = (category: QuestionCategory, difficulty: QuestionDifficulty, isCorrect: boolean): ScoredAnswer => ({
  category,
  difficulty,
  isCorrect,
});

/** A Diagnostic-shaped answer set: Easy and Medium in every category, Hard where Medium was right. */
function randomDiagnostic(seed: string): ScoredAnswer[] {
  const random = createRandom(seed);
  const answers: ScoredAnswer[] = [];
  for (const c of ALL_CATEGORIES) {
    answers.push(answer(c, "EASY", random() < 0.78));
    const medium = random() < 0.57;
    answers.push(answer(c, "MEDIUM", medium));
    if (medium) answers.push(answer(c, "HARD", random() < 0.41));
  }
  return answers;
}

describe("estimateAbilities", () => {
  it("puts a student with no answers at the population mean in every category", () => {
    const abilities = estimateAbilities([]);
    for (const c of ALL_CATEGORIES) expect(abilities[c]).toBeCloseTo(ABILITY_MODEL.populationMean, 9);
  });

  it("lands on the posterior mode: the gradient is zero there", () => {
    const answers = randomDiagnostic("mode");
    const abilities = estimateAbilities(answers);
    const s = ABILITY_LOGISTIC_SCALE;
    const { populationMean, sectionSd, categorySd } = ABILITY_MODEL;
    // Recover the section and deviation parts: within a section, every
    // category shares the section ability.
    for (const section of ["READING_WRITING", "MATH"] as const) {
      const categories = ALL_CATEGORIES.filter((c) => CATEGORY_SECTION[c] === section);
      const residual = (c: QuestionCategory) =>
        answers
          .filter((a) => a.category === c)
          .reduce((sum, a) => sum + s * ((a.isCorrect ? 1 : 0) - expectedProbability(questionRating(c, a.difficulty), abilities[c])), 0);
      // Each deviation's own condition: residual = deviation / categorySd².
      // Summed over the section, the section's condition gives:
      // Σ residual = (section − mean) / sectionSd², with Σ deviation = Σ residual × categorySd².
      const sumResidual = categories.reduce((sum, c) => sum + residual(c), 0);
      const deviations = categories.map((c) => residual(c) * categorySd ** 2);
      const sectionAbility = abilities[categories[0]] - deviations[0];
      for (let i = 1; i < categories.length; i++) {
        expect(abilities[categories[i]] - deviations[i]).toBeCloseTo(sectionAbility, 5);
      }
      expect(sumResidual).toBeCloseTo((sectionAbility - populationMean) / sectionSd ** 2, 6);
    }
  });

  it("is deterministic and doesn't depend on the order of the answers", () => {
    const answers = randomDiagnostic("order");
    expect(estimateAbilities([...answers].reverse())).toEqual(estimateAbilities(answers));
  });

  it("never lowers any category when a wrong answer becomes right", () => {
    for (let trial = 0; trial < 40; trial++) {
      const answers = randomDiagnostic(`flip-${trial}`);
      const before = estimateAbilities(answers);
      answers.forEach((a, i) => {
        if (a.isCorrect) return;
        const after = estimateAbilities(answers.map((b, j) => (j === i ? { ...b, isCorrect: true } : b)));
        for (const c of ALL_CATEGORIES) expect(after[c]).toBeGreaterThanOrEqual(before[c] - 1e-9);
        expect(after[a.category]).toBeGreaterThan(before[a.category]);
      });
    }
  });

  it("lets an answer inform the rest of its section, less than its own category, and not the other section", () => {
    const base = estimateAbilities([]);
    const after = estimateAbilities([answer("ALGEBRA", "MEDIUM", true)]);
    const rise = (c: QuestionCategory) => after[c] - base[c];
    expect(rise("ALGEBRA")).toBeGreaterThan(rise("ADVANCED_MATH"));
    expect(rise("ADVANCED_MATH")).toBeGreaterThan(0);
    expect(rise("READING_COMPREHENSION")).toBeCloseTo(0, 9);
  });

  it("gives more weight to a surprising answer than an expected one", () => {
    const base = estimateAbilities([]).ALGEBRA;
    const hardRight = estimateAbilities([answer("ALGEBRA", "HARD", true)]).ALGEBRA - base;
    const easyRight = estimateAbilities([answer("ALGEBRA", "EASY", true)]).ALGEBRA - base;
    expect(hardRight).toBeGreaterThan(easyRight);
  });

  it("starts a section wherever it's told to, and lets the answers move it from there", () => {
    const answers = randomDiagnostic("start");
    const typical = estimateAbilities(answers);
    const high = estimateAbilities(answers, { sectionPriorMean: { MATH: 80 } });
    for (const c of ALL_CATEGORIES) {
      if (CATEGORY_SECTION[c] === "MATH") expect(high[c]).toBeGreaterThan(typical[c]);
      else expect(high[c]).toBeCloseTo(typical[c], 9);
    }
    // With no answers at all, the start is the estimate.
    expect(estimateAbilities([], { sectionPriorMean: { MATH: 80 } }).ALGEBRA).toBeCloseTo(80, 9);
  });

  it("stays within 0-100 however lopsided the answers", () => {
    const allRight = ALL_CATEGORIES.flatMap((c) => Array.from({ length: 200 }, () => answer(c, "HARD", true)));
    const allWrong = ALL_CATEGORIES.flatMap((c) => Array.from({ length: 200 }, () => answer(c, "EASY", false)));
    for (const c of ALL_CATEGORIES) {
      expect(estimateAbilities(allRight)[c]).toBeLessThanOrEqual(100);
      expect(estimateAbilities(allWrong)[c]).toBeGreaterThanOrEqual(0);
    }
  });
});
