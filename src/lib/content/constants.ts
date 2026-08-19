import type { CalculatorSetting, QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";

// PRD-015 §4.5: "Category sorting must use the fixed category order defined in
// PRD-013" — this is the same 7-category order as CLAUDE.md's core invariants.
export const CATEGORY_ORDER: QuestionCategory[] = [
  "READING_COMPREHENSION",
  "GRAMMAR",
  "VOCABULARY",
  "ALGEBRA",
  "GEOMETRY_TRIGONOMETRY",
  "ADVANCED_MATH",
  "PROBLEM_SOLVING_DATA_ANALYSIS",
];

export const DIFFICULTY_ORDER: QuestionDifficulty[] = ["EASY", "MEDIUM", "HARD"];

// PRD-015 §8.1: only these categories may belong to a Question Family.
export const FAMILY_ELIGIBLE_CATEGORIES: QuestionCategory[] = [
  "ALGEBRA",
  "GEOMETRY_TRIGONOMETRY",
  "ADVANCED_MATH",
  "PROBLEM_SOLVING_DATA_ANALYSIS",
];

export const FAMILY_VERSION_COUNT = 3;
export const MULTIPLE_CHOICE_OPTION_COUNT = 4;

// The digital SAT's Desmos calculator is available throughout the entire
// Math section and never restricted per-question — so calculator access is a
// fixed function of category, not an Owner-editable per-question choice.
// Happens to be the same 4 categories as FAMILY_ELIGIBLE_CATEGORIES (Question
// Families are also math-only), but the two lists encode different rules and
// are kept separate rather than aliased, so one can change independently of
// the other if either rule is ever revisited.
export const CALCULATOR_ALLOWED_CATEGORIES: QuestionCategory[] = [
  "ALGEBRA",
  "GEOMETRY_TRIGONOMETRY",
  "ADVANCED_MATH",
  "PROBLEM_SOLVING_DATA_ANALYSIS",
];

export function getCalculatorSettingForCategory(category: QuestionCategory): CalculatorSetting {
  return CALCULATOR_ALLOWED_CATEGORIES.includes(category) ? "ALLOWED" : "NOT_ALLOWED";
}

// Suggested time is a fixed function of difficulty, not an Owner-editable
// per-question choice — same reasoning/pattern as calculator access above.
export const SUGGESTED_TIME_SECONDS_BY_DIFFICULTY: Record<QuestionDifficulty, number> = {
  EASY: 60,
  MEDIUM: 90,
  HARD: 180,
};

export function getSuggestedTimeForDifficulty(difficulty: QuestionDifficulty): number {
  return SUGGESTED_TIME_SECONDS_BY_DIFFICULTY[difficulty];
}

// Bulk upload no longer asks the Owner to pre-sort images by difficulty
// upfront — unlike category (see classify-category.ts), difficulty judgment
// genuinely varies by reviewer and AI classification isn't trusted for it, so
// every bulk-uploaded question starts at this single neutral placeholder and
// the Owner corrects it per question afterward (see the question editor's
// Difficulty field and its Previous/Next navigation, built for exactly this
// pass).
export const DEFAULT_BULK_UPLOAD_DIFFICULTY: QuestionDifficulty = "MEDIUM";
