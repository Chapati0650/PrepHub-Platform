import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { CATEGORY_ORDER } from "@/lib/content/constants";

// PRD-014 §3 "Core Configuration" — every tunable value the engine uses lives
// here, not hardcoded at call sites. Bumping ENGINE_VERSION on any change to
// this file (or the formulas that read it) is how we keep historical
// FinalizedAttempt/PredictionHistoryEntry rows honest about which rules
// produced them — configuration changes must never rewrite history retroactively.
//
// 2026.2 (2026-11-06) replaced PRD-014's hand-set numbers with ones fitted to
// production answers: per-category ratings, a population model the Diagnostic
// is scored under, and a step size that shrinks as evidence accumulates. See
// CLAUDE.md "The calibrated engine".
export const ENGINE_VERSION = "2026.2";

export const PRACTICE_SET_SIZE = 21;
export const GUARANTEED_QUESTIONS_PER_CATEGORY = 1;
export const ADDITIONAL_PRIORITY_ALLOCATED_QUESTIONS = 14;
export const MAX_QUESTIONS_PER_CATEGORY = 5;
export const MIN_ABILITY = 0.0;
export const MAX_ABILITY = 100.0;
export const MAX_ABILITY_CHANGE_PER_ANSWER = 5.0;
export const RECENT_PERFORMANCE_WINDOW = 5;

export const WEAKNESS_PRIORITY_WEIGHT = 0.8;
export const RECENT_STRUGGLE_PRIORITY_WEIGHT = 0.15;
export const FOCUS_RECENCY_PRIORITY_WEIGHT = 0.05;

// PRD-014 §6.2's curve: 40 ability points is a tenfold change in the odds of
// a right answer. Every rating, prior and step below is in these units.
export const ABILITY_LOGISTIC_SCALE = Math.LN10 / 40;

// PRD-014 §6.1, calibrated. One rating per category and difficulty (a
// question still never has a rating of its own), fitted on 2026-11-06 to the
// 2,157 Diagnostic and Practice answers real students had given, with each
// category's ratings pooled toward its difficulty's average (they rest on
// ~100 answers each). The old flat 35/60/85 set every question too hard:
// students beat the engine's expectation at every difficulty, so abilities
// climbed for as long as anyone practised. Fitted with the population mean
// fixed at 50, so 50 is a typical PrepHub student in every category.
export const DIFFICULTY_RATING: Record<QuestionCategory, Record<QuestionDifficulty, number>> = {
  READING_COMPREHENSION: { EASY: 26.4, MEDIUM: 46.2, HARD: 55.5 },
  GRAMMAR: { EASY: 21.6, MEDIUM: 42.7, HARD: 50.2 },
  VOCABULARY: { EASY: 16.8, MEDIUM: 34.5, HARD: 57.1 },
  ALGEBRA: { EASY: 26.8, MEDIUM: 37.6, HARD: 56.2 },
  ADVANCED_MATH: { EASY: 22.5, MEDIUM: 50.4, HARD: 60.3 },
  PROBLEM_SOLVING_DATA_ANALYSIS: { EASY: 32.0, MEDIUM: 45.6, HARD: 55.0 },
  GEOMETRY_TRIGONOMETRY: { EASY: 36.8, MEDIUM: 53.0, HARD: 64.4 },
};

export function questionRating(category: QuestionCategory, difficulty: QuestionDifficulty): number {
  return DIFFICULTY_RATING[category][difficulty];
}

export type ScoreSection = "READING_WRITING" | "MATH";

export const CATEGORY_SECTION: Record<QuestionCategory, ScoreSection> = {
  READING_COMPREHENSION: "READING_WRITING",
  GRAMMAR: "READING_WRITING",
  VOCABULARY: "READING_WRITING",
  ALGEBRA: "MATH",
  ADVANCED_MATH: "MATH",
  PROBLEM_SOLVING_DATA_ANALYSIS: "MATH",
  GEOMETRY_TRIGONOMETRY: "MATH",
};

// The population model abilities are estimated under (estimate.ts): a
// student's ability in a category is their section ability plus a smaller
// category-specific deviation. Both spreads were chosen by cross-validation
// on the same answers. The category spread is small because two or three
// Diagnostic questions per category can't tell a real category weakness from
// a bad guess; a real one emerges as Practice answers accumulate.
export const ABILITY_MODEL = {
  populationMean: 50,
  sectionSd: 12,
  categorySd: 5,
} as const;

// PRD-014 §6.3, derived rather than staged. An answer moves ability by
// K × (result − expected), and the right K is the uncertainty left in the
// estimate: K = scale × variance, with the variance shrinking by each
// answer's information. The old K of 10 moved a category about seven times
// further per answer than the evidence supports. Between completions this is
// the running estimate; each completed set recomputes every category from
// the whole history (estimate.ts), so the step only has to be sensible.
export const ONLINE_STARTING_SD = 5;
export const AVERAGE_ANSWER_INFORMATION = 0.22;

// PRD-014 §7.3 Focus Recency — F = min(25N, 100).
export const FOCUS_RECENCY_POINTS_PER_SET = 25;
export const FOCUS_RECENCY_MAX = 100;

// PRD-014 §9 — weighted difficulty distribution, by how far the category's
// ability sits from that category's Medium rating. The offsets are the
// original bands' distances from the original flat Medium rating of 60, so a
// student meets the mix the PRD specified at the same chance of success; only
// what "Medium" means is now measured per category. Bands are
// [minInclusive, maxExclusive).
export type DifficultyDistribution = { easy: number; medium: number; hard: number };
export const DIFFICULTY_DISTRIBUTION_BANDS: { min: number; max: number; distribution: DifficultyDistribution }[] = [
  { min: -Infinity, max: -30, distribution: { easy: 0.75, medium: 0.25, hard: 0.0 } },
  { min: -30, max: -15, distribution: { easy: 0.55, medium: 0.45, hard: 0.0 } },
  { min: -15, max: 0, distribution: { easy: 0.4, medium: 0.5, hard: 0.1 } },
  { min: 0, max: 15, distribution: { easy: 0.25, medium: 0.6, hard: 0.15 } },
  { min: 15, max: 30, distribution: { easy: 0.15, medium: 0.55, hard: 0.3 } },
  { min: 30, max: Infinity, distribution: { easy: 0.05, medium: 0.35, hard: 0.6 } },
];

export function distributionForAbility(ability: number, category: QuestionCategory): DifficultyDistribution {
  const offset = ability - questionRating(category, "MEDIUM");
  const band = DIFFICULTY_DISTRIBUTION_BANDS.find((b) => offset >= b.min && offset < b.max);
  return band?.distribution ?? DIFFICULTY_DISTRIBUTION_BANDS[DIFFICULTY_DISTRIBUTION_BANDS.length - 1].distribution;
}

export const ALL_CATEGORIES: QuestionCategory[] = CATEGORY_ORDER;

export function kValueFor(previousAdaptiveAnswersInCategory: number): number {
  const s = ABILITY_LOGISTIC_SCALE;
  const precision = 1 / ONLINE_STARTING_SD ** 2 + previousAdaptiveAnswersInCategory * s ** 2 * AVERAGE_ANSWER_INFORMATION;
  return s / precision;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
