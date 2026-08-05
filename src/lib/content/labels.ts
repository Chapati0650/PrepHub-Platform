import type {
  CalculatorSetting,
  ContentStatus,
  MediaStatus,
  QuestionCategory,
  QuestionDifficulty,
  QuestionType,
} from "@/generated/prisma/client";

// Fixed terminology (CLAUDE.md) — these are internal enum values; only the
// labels below are ever shown to the Owner.
export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  READING_COMPREHENSION: "Reading Comprehension",
  GRAMMAR: "Grammar",
  VOCABULARY: "Vocabulary",
  ALGEBRA: "Algebra",
  GEOMETRY_TRIGONOMETRY: "Geometry & Trig",
  ADVANCED_MATH: "Advanced Math",
  PROBLEM_SOLVING_DATA_ANALYSIS: "Problem Solving & Data Analysis",
};

export const DIFFICULTY_LABELS: Record<QuestionDifficulty, string> = {
  EASY: "Easy",
  MEDIUM: "Medium",
  HARD: "Hard",
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "Multiple Choice",
  OPEN_ENDED_NUMERIC: "Open-Ended Numeric",
};

export const STATUS_LABELS: Record<ContentStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  DRAFT_REVISION: "Draft Revision",
  ARCHIVED: "Archived",
};

export const CALCULATOR_LABELS: Record<CalculatorSetting, string> = {
  ALLOWED: "Calculator Allowed",
  NOT_ALLOWED: "Calculator Not Allowed",
};

export const MEDIA_STATUS_LABELS: Record<MediaStatus, string> = {
  UPLOADING: "Uploading…",
  PROCESSING: "Processing…",
  READY: "Ready",
  FAILED: "Failed",
};

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
