import { describe, expect, it } from "vitest";
import type { QuestionCategory } from "@/generated/prisma/client";
import { ABILITY_MODEL, ALL_CATEGORIES, CATEGORY_SECTION, type ScoreSection } from "@/lib/adaptive/config";
import type { ScoredAnswer } from "@/lib/adaptive/estimate";
import { CATEGORY_WEIGHT, SECTION_SCORE_LINES, abilityForSectionScore } from "@/lib/score/config";
import {
  BLUEPRINT_CATEGORY_SHARE,
  BLUEPRINT_NOTES,
  QUESTION_VALUE_LIMITS,
  SCORED_QUESTIONS,
  questionPointValue,
  questionValueSentence,
  realTestMix,
  roundToStep,
  routingProbabilityOfHarderModule,
  sectionScoreSd,
} from "@/lib/score/real-test";

function abilitiesAt(value: number): Record<QuestionCategory, number> {
  return Object.fromEntries(ALL_CATEGORIES.map((c) => [c, value])) as Record<QuestionCategory, number>;
}

/** Every category at the ability whose section score is `score`. */
function atScore(section: ScoreSection, score: number): Record<QuestionCategory, number> {
  return abilitiesAt(abilityForSectionScore(section, score));
}

describe("the blueprint", () => {
  it("sums to 100% in each section", () => {
    for (const domains of Object.values(BLUEPRINT_NOTES)) {
      expect(Object.values(domains).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
  });

  it("agrees with the weights the score is aggregated by, to within one point of share", () => {
    for (const category of ALL_CATEGORIES) {
      expect(Math.abs(BLUEPRINT_CATEGORY_SHARE[category] - CATEGORY_WEIGHT[category])).toBeLessThanOrEqual(0.011);
    }
  });

  it("has the real section sizes: 50 scored Reading and Writing questions, 40 scored Math", () => {
    expect(SCORED_QUESTIONS).toEqual({ READING_WRITING: 50, MATH: 40 });
  });
});

describe("roundToStep", () => {
  it("rounds to the nearest 10, halves up", () => {
    expect(roundToStep(1234)).toBe(1230);
    expect(roundToStep(1235)).toBe(1240);
    expect(roundToStep(1239.9)).toBe(1240);
    expect(roundToStep(200)).toBe(200);
  });
});

describe("realTestMix", () => {
  it("is a distribution over the three difficulties", () => {
    for (const ability of [0, 30, 60, 100]) {
      const mix = realTestMix("ALGEBRA", ability);
      expect(mix.EASY + mix.MEDIUM + mix.HARD).toBeCloseTo(1, 9);
      expect(Math.min(mix.EASY, mix.MEDIUM, mix.HARD)).toBeGreaterThan(0);
    }
  });

  it("serves a stronger student a harder second module", () => {
    const weak = realTestMix("ADVANCED_MATH", 15);
    const strong = realTestMix("ADVANCED_MATH", 85);
    expect(strong.HARD).toBeGreaterThan(weak.HARD);
    expect(strong.EASY).toBeLessThan(weak.EASY);
  });
});

describe("routingProbabilityOfHarderModule", () => {
  it("rises with ability", () => {
    for (const section of ["READING_WRITING", "MATH"] as const) {
      let previous = -1;
      for (let ability = 0; ability <= 100; ability += 10) {
        const p = routingProbabilityOfHarderModule(section, ability);
        expect(p).toBeGreaterThanOrEqual(previous);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        previous = p;
      }
    }
  });

  it("sends almost everyone who could score above the easier module's ceiling to the harder one", () => {
    // Third-party estimates put the easier path's ceiling near 600-650, which is
    // why routing is left out of the score: it binds only where nobody is routed.
    for (const section of ["READING_WRITING", "MATH"] as const) {
      expect(routingProbabilityOfHarderModule(section, abilityForSectionScore(section, 660))).toBeGreaterThan(0.9);
      expect(routingProbabilityOfHarderModule(section, abilityForSectionScore(section, 300))).toBeLessThan(0.1);
    }
  });
});

describe("questionPointValue", () => {
  it("lands in 10-30 points for typical students in both sections, across all categories and difficulties", () => {
    for (const section of ["READING_WRITING", "MATH"] as const) {
      for (const score of [350, 400, 450, 500, 550, 600, 650]) {
        const abilities = atScore(section, score);
        for (const category of ALL_CATEGORIES.filter((c) => CATEGORY_SECTION[c] === section)) {
          // A question the student has a reasonable chance on (Easy and Medium
          // here, and Hard when it isn't far out of reach).
          for (const difficulty of ["EASY", "MEDIUM"] as const) {
            const { exact, points } = questionPointValue(abilities, category, difficulty);
            expect(exact).toBeGreaterThan(8);
            expect(exact).toBeLessThan(32);
            expect(points).toBeGreaterThanOrEqual(10);
            expect(points).toBeLessThanOrEqual(30);
          }
        }
      }
    }
  });

  it("is worth more near the top, where few questions can tell students apart", () => {
    for (const section of ["READING_WRITING", "MATH"] as const) {
      const category = section === "MATH" ? "ALGEBRA" : "GRAMMAR";
      const middle = questionPointValue(atScore(section, 500), category, "MEDIUM").exact;
      const high = questionPointValue(atScore(section, 700), category, "MEDIUM").exact;
      const top = questionPointValue(atScore(section, 780), category, "MEDIUM").exact;
      expect(high).toBeGreaterThan(middle);
      expect(top).toBeGreaterThan(high);
      expect(top).toBeGreaterThanOrEqual(25);
    }
  });

  it("averages the section's range over its scored questions: 40 or 50 questions across ~600 points is about 12-15 each", () => {
    // Sanity against the public arithmetic, not a fitted number.
    const reading = questionPointValue(atScore("READING_WRITING", 500), "GRAMMAR", "MEDIUM").exact;
    const math = questionPointValue(atScore("MATH", 500), "ALGEBRA", "MEDIUM").exact;
    expect(reading).toBeGreaterThan(600 / SCORED_QUESTIONS.READING_WRITING - 4);
    expect(reading).toBeLessThan(600 / SCORED_QUESTIONS.READING_WRITING + 6);
    expect(math).toBeGreaterThan(600 / SCORED_QUESTIONS.MATH - 4);
    expect(math).toBeLessThan(600 / SCORED_QUESTIONS.MATH + 6);
  });

  it("values a miss on an easier question at least as much as on one the student could only guess", () => {
    const abilities = atScore("MATH", 400);
    const easy = questionPointValue(abilities, "ALGEBRA", "EASY").exact;
    const medium = questionPointValue(abilities, "ALGEBRA", "MEDIUM").exact;
    const hard = questionPointValue(abilities, "ALGEBRA", "HARD").exact;
    expect(easy).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(hard);
  });

  it("gives a question beyond a student's reach (a guess) no more than the minimum shown", () => {
    const abilities = abilitiesAt(5);
    const value = questionPointValue(abilities, "GEOMETRY_TRIGONOMETRY", "HARD");
    expect(value.exact).toBeLessThan(1);
    expect(value.points).toBe(QUESTION_VALUE_LIMITS.min);
  });

  it("rounds to 10 and never exceeds the upper limit", () => {
    const value = questionPointValue(abilitiesAt(100), "ALGEBRA", "EASY");
    expect(value.points % 10).toBe(0);
    expect(value.points).toBeLessThanOrEqual(QUESTION_VALUE_LIMITS.max);
    const huge = questionPointValue(abilitiesAt(100), "ALGEBRA", "MEDIUM");
    expect(huge.points).toBe(QUESTION_VALUE_LIMITS.max);
    expect(huge.exact).toBeGreaterThan(QUESTION_VALUE_LIMITS.max);
  });

  it("depends on the question's own category ability, not only the section's", () => {
    const base = abilitiesAt(50);
    const weakAlgebra = { ...base, ALGEBRA: 25 };
    expect(questionPointValue(weakAlgebra, "ALGEBRA", "MEDIUM").exact).not.toBeCloseTo(
      questionPointValue(base, "ALGEBRA", "MEDIUM").exact,
      3,
    );
  });

  it("phrases the value as the real SAT would cost it", () => {
    expect(questionValueSentence(20)).toBe("On the real SAT, a question like this is worth about 20 points at your level.");
  });
});

describe("sectionScoreSd", () => {
  const answers = (n: number): ScoredAnswer[] =>
    Array.from({ length: n }, (_, i) => ({
      category: ALL_CATEGORIES[i % ALL_CATEGORIES.length],
      difficulty: (["EASY", "MEDIUM", "HARD"] as const)[i % 3],
      isCorrect: i % 2 === 0,
    }));

  it("is the prior's spread with no answers: section ability plus the weighted category deviations", () => {
    for (const section of ["READING_WRITING", "MATH"] as const) {
      const weights = ALL_CATEGORIES.filter((c) => CATEGORY_SECTION[c] === section).map((c) => CATEGORY_WEIGHT[c]);
      const variance = ABILITY_MODEL.sectionSd ** 2 + weights.reduce((a, w) => a + w * w, 0) * ABILITY_MODEL.categorySd ** 2;
      expect(sectionScoreSd(section, [], abilitiesAt(50))).toBeCloseTo(SECTION_SCORE_LINES[section].slope * Math.sqrt(variance), 9);
    }
  });

  it("shrinks as answers accumulate, and never below zero", () => {
    let previous = Infinity;
    for (const n of [0, 7, 28, 70, 210, 700]) {
      const sd = sectionScoreSd("MATH", answers(n), abilitiesAt(50));
      expect(sd).toBeGreaterThan(0);
      expect(sd).toBeLessThan(previous);
      previous = sd;
    }
  });

  it("ignores answers from the other section", () => {
    const mathOnly = answers(40).filter((a) => CATEGORY_SECTION[a.category] === "MATH");
    expect(sectionScoreSd("READING_WRITING", mathOnly, abilitiesAt(50))).toBeCloseTo(sectionScoreSd("READING_WRITING", [], abilitiesAt(50)), 9);
  });

  it("is about 30-40 points a section after a Diagnostic and a few sets, and tens of points wide after hundreds of answers", () => {
    const afterDiagnostic = sectionScoreSd("READING_WRITING", answers(10), abilitiesAt(50));
    expect(afterDiagnostic).toBeGreaterThan(40);
    expect(afterDiagnostic).toBeLessThan(120);
    const afterMany = sectionScoreSd("READING_WRITING", answers(400), abilitiesAt(50));
    expect(afterMany).toBeGreaterThan(8);
    expect(afterMany).toBeLessThan(35);
  });
});
