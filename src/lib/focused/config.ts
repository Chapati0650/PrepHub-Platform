import type { FocusedDifficulty, QuestionCategory } from "@/generated/prisma/client";

/**
 * Focused Practice — the student picks what to drill.
 *
 * Why this exists: until now the only questions a student could steer were
 * the Diagnostic's successor sets, which are deliberately chosen *for* them.
 * A student who knows Advanced Math is their weak spot had no way to say so
 * and work on it; they could only keep taking 21-question sets and hope the
 * allocator agreed.
 *
 * Why it is not the question bank: handing a student a browsable bank turns
 * practice into shopping, burns the unseen pool on whatever looks easiest,
 * and makes the "unseen first" guarantee impossible to keep. Choosing a
 * category and a difficulty gives the same sense of control over what you
 * work on without letting anyone cherry-pick individual questions.
 *
 * Ten questions, matching the 800 Club rather than a 21-question Practice
 * Set: a drill is meant to be a short, repeatable sitting on one skill.
 */
export const FOCUSED_SESSION_SIZE = 10;

export const FOCUSED_CATEGORY_ORDER: readonly QuestionCategory[] = [
  "READING_COMPREHENSION",
  "GRAMMAR",
  "VOCABULARY",
  "ALGEBRA",
  "GEOMETRY_TRIGONOMETRY",
  "ADVANCED_MATH",
  "PROBLEM_SOLVING_DATA_ANALYSIS",
];

/**
 * The 7 fixed skill categories (CLAUDE.md: do not add, remove or rename).
 * Labels here must match the wording used everywhere else in the product.
 */
export const FOCUSED_CATEGORY_LABELS: Record<QuestionCategory, string> = {
  READING_COMPREHENSION: "Reading Comprehension",
  GRAMMAR: "Grammar",
  VOCABULARY: "Vocabulary",
  ALGEBRA: "Algebra",
  GEOMETRY_TRIGONOMETRY: "Geometry & Trig",
  ADVANCED_MATH: "Advanced Math",
  PROBLEM_SOLVING_DATA_ANALYSIS: "Problem Solving & Data Analysis",
};

export const FOCUSED_DIFFICULTY_ORDER: readonly FocusedDifficulty[] = [
  "EASY",
  "MEDIUM",
  "HARD",
  "MIXED",
];

export const FOCUSED_DIFFICULTY_LABELS: Record<FocusedDifficulty, string> = {
  EASY: "Easy",
  MEDIUM: "Medium",
  HARD: "Hard",
  MIXED: "Mixed",
};

export const FOCUSED_DIFFICULTY_BLURBS: Record<FocusedDifficulty, string> = {
  EASY: "Build the habit back up on a category you have been avoiding.",
  MEDIUM: "The bulk of a real test sits here.",
  HARD: "The questions that separate a good score from a great one.",
  MIXED: "An even spread, closest to how the category appears on test day.",
};

export function isFocusedDifficulty(value: unknown): value is FocusedDifficulty {
  return (
    value === "EASY" || value === "MEDIUM" || value === "HARD" || value === "MIXED"
  );
}

export function isQuestionCategory(value: unknown): value is QuestionCategory {
  return (
    typeof value === "string" &&
    (FOCUSED_CATEGORY_ORDER as readonly string[]).includes(value)
  );
}
