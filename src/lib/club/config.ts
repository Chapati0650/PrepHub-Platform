import type { ClubSection, QuestionCategory } from "@/generated/prisma/client";

// 800 Club — the hardest questions in the bank, by section.
//
// The pool is "published HARD questions in the section's categories" — the
// Owner's decision (2026-09-19), rather than a separate 800-Club tag, so the
// Owner's own difficulty classification is what puts a question here.
// Sessions are shorter than a Practice Set on purpose: ten hard questions is
// a real sitting; twenty-one is a slog that stops being diagnostic of
// anything. If a section has fewer than ten published HARD questions, a
// session is as long as the pool allows (never empty — the page disables
// "Open" at zero).
export const CLUB_SESSION_SIZE = 10;

export const CLUB_SECTIONS: Record<
  ClubSection,
  { label: string; blurb: string; categories: readonly QuestionCategory[] }
> = {
  READING_WRITING: {
    label: "Reading & Writing",
    blurb: "The Module 2 questions that decide a 750+ verbal.",
    categories: ["READING_COMPREHENSION", "GRAMMAR", "VOCABULARY"],
  },
  MATH: {
    label: "Math",
    blurb: "The end-of-Module-2 questions that decide an 800.",
    categories: ["ALGEBRA", "GEOMETRY_TRIGONOMETRY", "ADVANCED_MATH", "PROBLEM_SOLVING_DATA_ANALYSIS"],
  },
};

export const CLUB_SECTION_ORDER: readonly ClubSection[] = ["READING_WRITING", "MATH"];

export function isClubSection(value: unknown): value is ClubSection {
  return value === "READING_WRITING" || value === "MATH";
}
