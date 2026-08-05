import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { CATEGORY_ORDER } from "@/lib/content/constants";

// PRD-014 §3 "Core Configuration" — every tunable value the engine uses lives
// here, not hardcoded at call sites. Bumping ENGINE_VERSION on any change to
// this file (or the formulas that read it) is how we keep historical
// FinalizedAttempt/PredictionHistoryEntry rows honest about which rules
// produced them — configuration changes must never rewrite history retroactively.
export const ENGINE_VERSION = "2026.1";

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

// PRD-014 §6.1 — every difficulty's fixed V1 rating (individual questions
// cannot have custom ratings in V1).
export const DIFFICULTY_RATING: Record<QuestionDifficulty, number> = {
  EASY: 35.0,
  MEDIUM: 60.0,
  HARD: 85.0,
};

// PRD-014 §6.3 — K-value depends on how many adaptive questions the student
// has already answered in that category, checked *before* the current answer.
export const K_VALUE_STAGES: { maxPreviousAnswers: number; k: number }[] = [
  { maxPreviousAnswers: 9, k: 10.0 },
  { maxPreviousAnswers: 29, k: 8.0 },
  { maxPreviousAnswers: Infinity, k: 6.0 },
];

// PRD-014 §5 — initializes ability from the diagnostic's exact Easy/Medium/Hard
// result pattern. Keyed as "E{0|1}M{0|1}H{0|1}" (1 = correct).
export const DIAGNOSTIC_ABILITY_INITIALIZATION: Record<string, number> = {
  E0M0H0: 25.0,
  E1M0H0: 40.0,
  E0M1H0: 45.0,
  E1M1H0: 65.0,
  E0M0H1: 50.0,
  E1M0H1: 75.0,
  E0M1H1: 80.0,
  E1M1H1: 90.0,
};

export function diagnosticPatternKey(easyCorrect: boolean, mediumCorrect: boolean, hardCorrect: boolean): string {
  return `E${easyCorrect ? 1 : 0}M${mediumCorrect ? 1 : 0}H${hardCorrect ? 1 : 0}`;
}

// PRD-014 §7.3 Focus Recency — F = min(25N, 100).
export const FOCUS_RECENCY_POINTS_PER_SET = 25;
export const FOCUS_RECENCY_MAX = 100;

// PRD-014 §9 — weighted difficulty distribution by category ability band.
// Bands are [minInclusive, maxExclusive) except the final band, which is inclusive of 100.
export type DifficultyDistribution = { easy: number; medium: number; hard: number };
export const DIFFICULTY_DISTRIBUTION_BANDS: { min: number; max: number; distribution: DifficultyDistribution }[] = [
  { min: 0, max: 30, distribution: { easy: 0.75, medium: 0.25, hard: 0.0 } },
  { min: 30, max: 45, distribution: { easy: 0.55, medium: 0.45, hard: 0.0 } },
  { min: 45, max: 60, distribution: { easy: 0.4, medium: 0.5, hard: 0.1 } },
  { min: 60, max: 75, distribution: { easy: 0.25, medium: 0.6, hard: 0.15 } },
  { min: 75, max: 90, distribution: { easy: 0.15, medium: 0.55, hard: 0.3 } },
  { min: 90, max: 100.000001, distribution: { easy: 0.05, medium: 0.35, hard: 0.6 } },
];

export function distributionForAbility(ability: number): DifficultyDistribution {
  const band = DIFFICULTY_DISTRIBUTION_BANDS.find((b) => ability >= b.min && ability < b.max);
  return band?.distribution ?? DIFFICULTY_DISTRIBUTION_BANDS[DIFFICULTY_DISTRIBUTION_BANDS.length - 1].distribution;
}

export const ALL_CATEGORIES: QuestionCategory[] = CATEGORY_ORDER;

export function kValueFor(previousAdaptiveAnswersInCategory: number): number {
  const stage = K_VALUE_STAGES.find((s) => previousAdaptiveAnswersInCategory <= s.maxPreviousAnswers);
  return stage?.k ?? K_VALUE_STAGES[K_VALUE_STAGES.length - 1].k;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
