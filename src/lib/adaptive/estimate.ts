import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import {
  ABILITY_LOGISTIC_SCALE,
  ABILITY_MODEL,
  ALL_CATEGORIES,
  CATEGORY_SECTION,
  MAX_ABILITY,
  MIN_ABILITY,
  clamp,
  questionRating,
  type ScoreSection,
} from "./config";
import { expectedProbability } from "./ability";

export type ScoredAnswer = { category: QuestionCategory; difficulty: QuestionDifficulty; isCorrect: boolean };

const SECTIONS: ScoreSection[] = ["READING_WRITING", "MATH"];

/**
 * Every category's ability that best explains a student's answers: the mode
 * of the posterior under ABILITY_MODEL. Pure and deterministic.
 *
 * This is the one estimate behind both the Diagnostic's prediction and every
 * Practice Set's, which is what keeps them on one scale. The old engine read
 * the Diagnostic through one hand-made table and practice through another,
 * and the two disagreed by about 140 points for an ordinary answer pattern.
 *
 * A category's ability is its section's ability plus a small deviation of its
 * own. So an Algebra answer also says something about Advanced Math, which is
 * how three Diagnostic questions in a category still produce a sensible number
 * for it. Each step is a Newton step on one coordinate; the objective is
 * strictly concave, so this converges to the same point from anywhere.
 *
 * Questions that were never served (a waived bonus question) are not answers
 * and must not be passed in. Counting one as wrong, as the old tables did,
 * marked down exactly the students who had already missed the Medium.
 */
export function estimateAbilities(
  answers: readonly ScoredAnswer[],
  options: { sectionPriorMean?: Partial<Record<ScoreSection, number>> } = {},
): Record<QuestionCategory, number> {
  const s = ABILITY_LOGISTIC_SCALE;
  const { sectionSd, categorySd } = ABILITY_MODEL;
  const priorMean = (sec: ScoreSection) => options.sectionPriorMean?.[sec] ?? ABILITY_MODEL.populationMean;

  const byCategory = new Map<QuestionCategory, ScoredAnswer[]>(ALL_CATEGORIES.map((c) => [c, []]));
  for (const answer of answers) byCategory.get(answer.category)?.push(answer);

  const section: Record<ScoreSection, number> = {
    READING_WRITING: priorMean("READING_WRITING"),
    MATH: priorMean("MATH"),
  };
  const deviation = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0])) as Record<QuestionCategory, number>;
  const abilityIn = (category: QuestionCategory) => section[CATEGORY_SECTION[category]] + deviation[category];

  // Gradient and curvature of the log-likelihood of one category's answers.
  const evidence = (category: QuestionCategory) => {
    let gradient = 0;
    let curvature = 0;
    const ability = abilityIn(category);
    for (const answer of byCategory.get(category) ?? []) {
      const p = expectedProbability(questionRating(category, answer.difficulty), ability);
      gradient += s * ((answer.isCorrect ? 1 : 0) - p);
      curvature += s * s * p * (1 - p);
    }
    return { gradient, curvature };
  };

  for (let iteration = 0; iteration < 200; iteration++) {
    let largestStep = 0;
    for (const sec of SECTIONS) {
      let gradient = -(section[sec] - priorMean(sec)) / sectionSd ** 2;
      let curvature = 1 / sectionSd ** 2;
      for (const category of ALL_CATEGORIES) {
        if (CATEGORY_SECTION[category] !== sec) continue;
        const e = evidence(category);
        gradient += e.gradient;
        curvature += e.curvature;
      }
      const step = gradient / curvature;
      section[sec] += step;
      largestStep = Math.max(largestStep, Math.abs(step));
    }
    for (const category of ALL_CATEGORIES) {
      const e = evidence(category);
      const step = (e.gradient - deviation[category] / categorySd ** 2) / (e.curvature + 1 / categorySd ** 2);
      deviation[category] += step;
      largestStep = Math.max(largestStep, Math.abs(step));
    }
    if (largestStep < 1e-7) break;
  }

  return Object.fromEntries(
    ALL_CATEGORIES.map((c) => [c, clamp(abilityIn(c), MIN_ABILITY, MAX_ABILITY)]),
  ) as Record<QuestionCategory, number>;
}

/** The Diagnostic's answers, as estimate input: answered and served, never a waived bonus question. */
export function diagnosticAnswers(
  attempts: readonly {
    category: QuestionCategory;
    difficulty: QuestionDifficulty;
    isCorrect: boolean | null;
    submittedAt: Date | null;
    waivedAt: Date | null;
  }[],
): ScoredAnswer[] {
  return attempts
    .filter((a) => !!a.submittedAt && !a.waivedAt)
    .map((a) => ({ category: a.category, difficulty: a.difficulty, isCorrect: !!a.isCorrect }));
}
