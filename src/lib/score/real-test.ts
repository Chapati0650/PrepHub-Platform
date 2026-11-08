// Scoring as the real digital SAT reports it (engine and scoring version 2026.3).
//
// What College Board publishes: each section is two modules, the second routed
// by the first, scored by item response theory (which questions were right,
// weighted by difficulty, not a raw count) and reported in 10-point steps. It
// publishes no per-question point values or curves, so everything below that
// is not a published fact is labelled as an assumption.
//
// PrepHub's ability model already is an item response model (one logistic
// curve per category and difficulty, fitted to real answers), so the real
// test's scoring is expressed through it rather than imitated beside it:
//
//   - A section score is the section's ability on SECTION_SCORE_LINES,
//     rounded to 10. The categories are aggregated by the digital SAT's
//     domain blueprint (BLUEPRINT_NOTES): CATEGORY_WEIGHT already equals it
//     to within a point, so the aggregation is unchanged and tested to stay so.
//   - The honest uncertainty is the estimate's posterior (sectionScoreSd),
//     shown as a band; it shrinks as answers accumulate.
//   - What one question is worth is the slope of the score line divided by the
//     slope of the expected number correct on a full real section
//     (questionPointValue): a section of 50 or 40 scored questions spreads its
//     ~600-point range over that many questions, and the questions that
//     discriminate least (everything very easy or very hard for the student)
//     are worth most to the points near them, which is why one miss costs
//     about 10 to 30 points and more near the top.
//
// Module routing is deliberately not simulated for the score. The score line
// is anchored on College Board's own difficulty bands, which hold whatever
// path a student takes, and the easier second module's ceiling (third-party
// estimates 600-650) binds only a student routed there, i.e. one who answered
// module 1 so poorly that their expected section score is below it. A student
// expected to score 600 is routed to the harder module with probability ~0.9
// and one expected to score 660 or more with >0.9 (routingProbabilityOfHarderModule,
// tested), so the cap moves the expected score by a few points at most, less than
// the rounding. Routing does enter the per-question value, because a real second
// module is built for the student's level.
import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import {
  ABILITY_LOGISTIC_SCALE,
  ABILITY_MODEL,
  ALL_CATEGORIES,
  CATEGORY_SECTION,
  questionRating,
  type ScoreSection,
} from "@/lib/adaptive/config";
import type { ScoredAnswer } from "@/lib/adaptive/estimate";
import { expectedProbability } from "@/lib/adaptive/ability";
import { CATEGORY_WEIGHT, SECTION_SCORE_LINES, clamp } from "./config";

/** Scores are reported in steps of 10 on every section and the total. */
export const SCORE_STEP = 10;

/** Scored questions in a real section (excluding the two unscored pretest items in each module). */
export const SCORED_QUESTIONS: Record<ScoreSection, number> = { READING_WRITING: 50, MATH: 40 };

/**
 * The digital SAT's published domain blueprint (shares of a section's
 * questions) and how PrepHub's categories map onto it. The Expression of
 * Ideas share is assigned to Grammar and the words-in-context part of Craft
 * and Structure to Vocabulary; this mapping is an assumption, because
 * PrepHub's categories are coarser than College Board's skills.
 */
export const BLUEPRINT_NOTES = {
  READING_WRITING: {
    "Information and Ideas": 0.26,
    "Craft and Structure": 0.28,
    "Expression of Ideas": 0.2,
    "Standard English Conventions": 0.26,
  },
  MATH: { Algebra: 0.35, "Advanced Math": 0.35, "Problem-Solving and Data Analysis": 0.15, "Geometry and Trigonometry": 0.15 },
} as const;

/** The blueprint's share for each PrepHub category (Reading Comprehension = Information and Ideas + the non-vocabulary 18% of Craft and Structure). */
export const BLUEPRINT_CATEGORY_SHARE: Record<QuestionCategory, number> = {
  READING_COMPREHENSION: 0.26 + 0.18,
  GRAMMAR: 0.26 + 0.2,
  VOCABULARY: 0.1,
  ALGEBRA: 0.35,
  ADVANCED_MATH: 0.35,
  PROBLEM_SOLVING_DATA_ANALYSIS: 0.15,
  GEOMETRY_TRIGONOMETRY: 0.15,
};

/** z for an 80% interval: the band is "likely", not a guarantee. */
export const BAND_Z = 1.2816;
/** The band is never narrower than one reporting step either side. */
export const BAND_MIN_HALF_WIDTH = SCORE_STEP;

/** What a question can be shown as worth, in section points. */
export const QUESTION_VALUE_LIMITS = { min: 10, max: 40 } as const;

/**
 * Assumptions about a real section's questions, used only for what one
 * question is worth (not for the score itself):
 *  - module 1 is mixed difficulty;
 *  - module 2 is built for the student: each difficulty's share is weighted by
 *    how close its rating (for the category) is to the student's ability,
 *    with a spread of `moduleTwoSpread` ability points;
 *  - an answer to a question the student would mostly have guessed counts for
 *    less, as in a three-parameter model: the weight of a right answer is
 *    (p - c) / (p (1 - c)), where p is the student's chance of the question,
 *    scaled so the section's average is 1. c is 0.15, below the 0.25 of four
 *    choices, because PrepHub's curves are fitted to answers that already
 *    include lucky guesses; a miss on a question far out of reach costs next
 *    to nothing, one on a question the student should get costs the most.
 */
export const REAL_TEST_ASSUMPTIONS = {
  moduleOneMix: { EASY: 0.25, MEDIUM: 0.45, HARD: 0.3 } as Record<QuestionDifficulty, number>,
  moduleTwoSpread: 15,
  guessingFloor: 0.15,
} as const;

const DIFFICULTIES: QuestionDifficulty[] = ["EASY", "MEDIUM", "HARD"];

export function roundToStep(score: number): number {
  return Math.round(score / SCORE_STEP) * SCORE_STEP;
}

/** The share of a real section's questions at each difficulty for one category, at ability `ability`. */
export function realTestMix(category: QuestionCategory, ability: number): Record<QuestionDifficulty, number> {
  const targeted = DIFFICULTIES.map((d) =>
    Math.exp(-0.5 * ((questionRating(category, d) - ability) / REAL_TEST_ASSUMPTIONS.moduleTwoSpread) ** 2),
  );
  const total = targeted.reduce((a, b) => a + b, 0);
  const mix = {} as Record<QuestionDifficulty, number>;
  DIFFICULTIES.forEach((d, i) => {
    mix[d] = 0.5 * REAL_TEST_ASSUMPTIONS.moduleOneMix[d] + 0.5 * (total > 0 ? targeted[i] / total : 1 / 3);
  });
  return mix;
}

/**
 * Chance a student of this section ability reaches the harder second module:
 * the share of module 1's 25 scored questions they are expected to answer
 * right, against a 60% cut, treated as a normal with the binomial spread. The
 * cut is an assumption (College Board publishes none). Used to document, and
 * test, that the easier module's ceiling only binds where routing sends
 * almost nobody.
 */
export function routingProbabilityOfHarderModule(section: ScoreSection, sectionAbility: number): number {
  const questions = 25;
  let expected = 0;
  for (const category of ALL_CATEGORIES) {
    if (CATEGORY_SECTION[category] !== section) continue;
    const mix = REAL_TEST_ASSUMPTIONS.moduleOneMix;
    const p = DIFFICULTIES.reduce((sum, d) => sum + mix[d] * expectedProbability(questionRating(category, d), sectionAbility), 0);
    expected += CATEGORY_WEIGHT[category] * p;
  }
  const sd = Math.sqrt((expected * (1 - expected)) / questions);
  const z = (expected - 0.6) / Math.max(sd, 1e-9);
  return 1 / (1 + Math.exp(-1.702 * z));
}

function guessWeight(p: number): number {
  const c = REAL_TEST_ASSUMPTIONS.guessingFloor;
  return p <= c ? 0 : (p - c) / (p * (1 - c));
}

/** The ability of a category's questions' answerers is the category's own; the section moves them together. */
type Abilities = Record<QuestionCategory, number>;

function sectionCategories(section: ScoreSection): QuestionCategory[] {
  return ALL_CATEGORIES.filter((c) => CATEGORY_SECTION[c] === section);
}

/**
 * Expected change in a full real section's number correct for one more point
 * of section ability (every category moving together), and the average
 * guessing weight of its questions.
 */
function sectionSlope(section: ScoreSection, abilities: Abilities): { slope: number; meanWeight: number } {
  const n = SCORED_QUESTIONS[section];
  const s = ABILITY_LOGISTIC_SCALE;
  let slope = 0;
  let weight = 0;
  for (const category of sectionCategories(section)) {
    const ability = abilities[category];
    const mix = realTestMix(category, ability);
    for (const d of DIFFICULTIES) {
      const count = n * CATEGORY_WEIGHT[category] * mix[d];
      const p = expectedProbability(questionRating(category, d), ability);
      slope += count * s * p * (1 - p);
      weight += count * guessWeight(p);
    }
  }
  return { slope, meanWeight: weight / n };
}

export type QuestionValue = {
  /** Section points, unrounded (before the display step and limits). */
  exact: number;
  /** What to show: rounded to 10 and kept within QUESTION_VALUE_LIMITS. */
  points: number;
};

/**
 * How many section points one more right answer to a question of this
 * category and difficulty is worth on a full real section, for a student at
 * these abilities: (score points per ability point) / (questions-correct per
 * ability point on the section), times this question's guessing weight over
 * the section's average. About 10-20 in the middle of the scale, 25-40 near
 * the top where few questions still tell students apart.
 */
export function questionPointValue(abilities: Abilities, category: QuestionCategory, difficulty: QuestionDifficulty): QuestionValue {
  const section = CATEGORY_SECTION[category];
  const { slope, meanWeight } = sectionSlope(section, abilities);
  const pointsPerQuestion = SECTION_SCORE_LINES[section].slope / slope;
  const p = expectedProbability(questionRating(category, difficulty), abilities[category]);
  const relative = meanWeight > 0 ? guessWeight(p) / meanWeight : 1;
  const exact = pointsPerQuestion * relative;
  return {
    exact,
    points: clamp(roundToStep(exact), QUESTION_VALUE_LIMITS.min, QUESTION_VALUE_LIMITS.max),
  };
}

/** One sentence, shown beside a question's value, on why a miss costs what it does. */
export const QUESTION_VALUE_EXPLAINER =
  "The real SAT doesn't count right answers: it scores which questions you got right, weighted by how hard they were for someone at your level. A full section has only 40 to 50 scored questions spread over about 600 points, so one question moves your section score roughly 10 to 30 points, and more near the top, where fewer questions can tell students apart.";

export function questionValueSentence(points: number): string {
  return `On the real SAT, a question like this is worth about ${points} points at your level.`;
}

/**
 * The standard deviation, in score points, of a section's score as estimated
 * from `answers`, under the same population model the abilities are estimated
 * under (ABILITY_MODEL): the section's ability and each category's deviation
 * from it have normal priors, and each answer adds its curvature at the
 * estimated ability. The section score depends on the weighted sum of the
 * section ability and its categories' deviations, whose posterior variance is
 *   (1 - sum w c/d)^2 / P + sum w^2 / d
 * with c a category's answer curvature, d = c + 1/categorySd^2, and
 * P = 1/sectionSd^2 + sum c - sum c^2/d. With no answers it is the prior
 * spread, so a student with no evidence gets a very wide band.
 */
export function sectionScoreSd(section: ScoreSection, answers: readonly ScoredAnswer[], abilities: Abilities): number {
  const s2 = ABILITY_LOGISTIC_SCALE ** 2;
  const priorCategory = 1 / ABILITY_MODEL.categorySd ** 2;
  let totalCurvature = 0;
  let crossTerm = 0;
  let weightedShare = 0;
  let weightedVariance = 0;
  for (const category of sectionCategories(section)) {
    let curvature = 0;
    for (const answer of answers) {
      if (answer.category !== category) continue;
      const p = expectedProbability(questionRating(category, answer.difficulty), abilities[category]);
      curvature += s2 * p * (1 - p);
    }
    const d = curvature + priorCategory;
    const w = CATEGORY_WEIGHT[category];
    totalCurvature += curvature;
    crossTerm += (curvature * curvature) / d;
    weightedShare += (w * curvature) / d;
    weightedVariance += (w * w) / d;
  }
  const precision = 1 / ABILITY_MODEL.sectionSd ** 2 + totalCurvature - crossTerm;
  const variance = (1 - weightedShare) ** 2 / precision + weightedVariance;
  return SECTION_SCORE_LINES[section].slope * Math.sqrt(variance);
}
