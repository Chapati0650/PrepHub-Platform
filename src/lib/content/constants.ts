import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";

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
